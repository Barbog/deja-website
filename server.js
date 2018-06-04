#!/usr/bin/env node
'use strict'

/**
 * Randomize array element order in-place.
 * Using Durstenfeld shuffle algorithm.
 * Sourced from http://stackoverflow.com/a/12646864.
 */
const shuffle = (array) => {
  if (!Array.isArray(array)) {
    return null
  }

  for (var i = array.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1))
    var temp = array[i]
    array[i] = array[j]
    array[j] = temp
  }

  return array
}

const getVisaPeriod = () => {
  const now = new Date()
  const applicationEnd = new Date(now.getFullYear(), 5, 1, 10) // June 1, 10:00
  return now.getFullYear() + ((+applicationEnd) > (+now) ? 0 : 1)
}

const crypto = require('crypto')
const fs = require('fs')
const https = require('https')
const path = require('path')
const querystring = require('querystring')
const url = require('url')

const readJsonFileSync = filename => JSON.parse(fs.readFileSync(path.join(__dirname, filename), { encoding: 'utf8' }))
const sitemap = readJsonFileSync('sitemap.json')
const ministrySlackChannels = readJsonFileSync('ministry-slack-channels.json')
const questions = readJsonFileSync('questions.json')
const visaApplication = readJsonFileSync('enter-deja.json')
const noAltsList = readJsonFileSync('no-alts-list.json')

const getAltLocales = locales => {
  if (typeof locales !== 'object' || locales === null) {
    return {}
  }

  return Object.keys(locales)
    .filter(locale => !noAltsList.includes(locale))
    .reduce((o, locale) => {
      o[locale] = locales[locale]
      return o
    }, {})
}

let keys = {}
const getKey = name => {
  if (keys.hasOwnProperty(name)) {
    return keys[name]
  }

  let localKeys = readJsonFileSync('keys.json')
  if (localKeys.hasOwnProperty(name)) {
    keys[name] = localKeys[name]
    return localKeys[name]
  }

  let defaultKeys = readJsonFileSync('keys.def.json')
  if (defaultKeys.hasOwnProperty(name)) {
    keys[name] = defaultKeys[name]
    return defaultKeys[name]
  }

  return null
}

const async = require('async')
const bcrypt = require('bcryptjs')
const env = require('get-env')()
const express = require('express')
const frontMatter = require('front-matter')
const interceptor = require('express-interceptor')
const i18n = require('i18n')
const less = require('less')
const lessCleanCss = new (require('less-plugin-clean-css'))({ s1: true, advanced: true })
const mailgun = require('mailgun-js')({ apiKey: getKey('mailgun'), domain: 'sparklatvia.lv' })
const PDFDocument = require('pdfkit')
PDFDocument.prototype.svg = function (svg, x, y, options) { require('svg-to-pdfkit')(this, svg, x, y, options); return this }
const randomstring = require('randomstring')
const redis = require(env === 'dev' ? 'fakeredis' : 'redis')
const showdown = new (require('showdown').Converter)()
const svgo = new (require('svgo'))()
const xlsx = require('xlsx')

let svgs = {}
const getSvg = filename => {
  if (svgs.hasOwnProperty(filename)) {
    return svgs[filename].data
  }

  let absPath = path.join(__dirname, 'static', filename)
  fs.readFile(absPath, { encoding: 'utf8' }, (err, source) => {
    if (!err) {
      svgo.optimize(source, { path: absPath }).then(svg => { svgs[filename] = svg })
    }
  })

  return null
}
const getSvgDir = directory =>
  fs.readdirSync(path.join(__dirname, 'static', directory)).forEach(filename => filename.endsWith('.svg') ? getSvg(path.join(directory, filename)) : null)
getSvgDir('images')
getSvgDir('images/global-events')
getSvgDir('images/principles')
getSvgDir('images/survival-guide')

const db = redis.createClient()
db.on('error', err => {
  console.error(err.stack)
})

if (env === 'dev') {
  const email = 'a.c@d.c'
  const name = 'Alternating Current'
  const password = randomstring.generate({ length: 8, readable: true, charset: 'alphanumeric' })

  bcrypt.hash(password, 10, (err, hash) => {
    if (err) {
      throw err
    }

    db.hmset('user:' + email, { password: hash, name: name }, err => {
      if (err) {
        throw err
      }

      console.log('The development account for "' + name + ' <' + email + '>" has been created.\n    Password: ' + password)
    })
  })
}

const app = express()
app.set('case sensitive routing', true)
app.set('env', env === 'dev' ? 'development' : 'production')
app.set('etag', 'strong')
app.set('port', process.env.PORT || 8080)
app.set('strict routing', true)
app.set('trust proxy', false)
app.set('view engine', 'pug')
app.set('views', path.join(__dirname, 'views'))
app.set('x-powered-by', false)

app.use(require('morgan')('dev'))
app.use(require('helmet')({ hsts: false }))
app.use(require('body-parser').json())
app.use(require('body-parser').urlencoded({ extended: true }))
app.use(require('cookie-parser')())
i18n.configure({
  locales: fs.readdirSync(path.join(__dirname, 'locales')).map(locale => path.basename(locale, '.json')),
  defaultLocale: 'en',
  cookie: 'lang',
  directory: path.join(__dirname, 'locales'),
  updateFiles: env === 'dev',
  syncFiles: env === 'dev'
})
app.use(i18n.init)
showdown.setFlavor('github')
showdown.setOption('omitExtraWLInCodeBlocks', true)
showdown.setOption('parseImgDimensions', true)
showdown.setOption('simplifiedAutoLink', true)
showdown.setOption('excludeTrailingPunctuationFromURLs', true)
showdown.setOption('literalMidWordUnderscores', true)
showdown.setOption('smoothLivePreview', true)
showdown.setOption('smartIndentationFix', true)
showdown.setOption('simpleLineBreaks', true)

const returnBadAction = (req, res) => {
  res.status(405)
  res.type('application/json; charset=utf-8')
  res.send('{}')
}

app.use((req, res, next) => {
  crypto.randomBytes(16, (err, buf) => {
    if (err) throw err
    res.locals.nonce = buf.toString('hex')
    next()
  })
})

app.use(interceptor((req, res) => {
  return {
    isInterceptable: () => res.get('Content-Type') === 'image/svg+xml',
    intercept: (body, send) => { svgo.optimize(body, {}).then(svg => { send(svg.data) }) }
  }
}))

app.use((req, res, next) => {
  res.set('Cache-Control', 'private, max-age=60') // may be overwritten as 'no-store' lower down
  res.set('Content-Security-Policy', 'base-uri \'self\';' +
    'connect-src \'self\';' +
    'default-src \'none\';' +
    'font-src \'self\' data:;' +
    'form-action \'self\';' +
    'frame-ancestors \'self\';' +
    'frame-src \'self\' https://player.vimeo.com;' +
    'img-src \'self\' data:;' +
    'object-src \'self\';' +
    'script-src \'self\' \'nonce-' + res.locals.nonce + '\' \'strict-dynamic\';' +
    'style-src \'unsafe-inline\' \'self\';')
  res.set('Referrer-Policy', 'no-referrer')
  res.set('X-Content-Type-Options', 'nosniff')
  res.set('X-Frame-Options', 'SAMEORIGIN')
  res.set('X-XSS-Protection', '1;mode=block')

  next()
})

if (env === 'dev') {
  app.get('/favicon.png', (req, res) => {
    const target = '/favicon.dev.png'
    res.render('redirect', { target: target }, (err, html) => {
      res.status(307)
      res.location(target)
      if (err) {
        res.type('text/plain; charset=utf-8')
        res.send(target)
        console.error(err.stack)
      } else {
        res.type('text/html; charset=utf-8')
        res.send(html)
      }
    })
  })
  app.all('/favicon.png', returnBadAction)
}

app.use(express.static(path.join(__dirname, 'static')))
app.use(express.static(path.join(__dirname, 'bower_components')))

app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

app.use((req, res, next) => {
  res.locals.acl = (acl) => {
    if (typeof acl === 'undefined' || acl === null) {
      return true
    }

    if (Array.isArray(acl)) {
      return acl.reduce((prev, next) => prev && res.locals.acl(next), true)
    }

    if (!res.locals.user) {
      return false
    }

    if (typeof acl === 'string') {
      acl = acl.split('{visaPeriod}').join('' + getVisaPeriod())

      return !!res.locals.user[acl]
    }

    return false
  }

  res.locals.svg = getSvg

  const token = req.cookies.token

  if (typeof token !== 'string' || token === '') {
    next()
    return
  }

  db.get('session:' + token, (err, reply) => {
    if (err) {
      next()
      return
    }

    if (typeof reply !== 'string' || reply === '') {
      next()
      return
    }

    db.hgetall('user:' + reply, (err, user) => {
      if (err || !user) {
        next()
        return
      }

      res.locals.user = Object.assign(user, {
        email: reply
      })
      next()
    })
  })
})

app.get('/', (req, res) => {
  const localeHash = {}

  i18n.getLocales().forEach(locale => {
    localeHash[locale] = '/' + locale + '/'
  })

  res.render('index', { altLocales: getAltLocales(localeHash), subpages: sitemap.slice(0) })
})
app.all('/', returnBadAction)

i18n.getLocales().forEach(locale => {
  app.get('/' + locale, (req, res) => {
    req.setLocale(locale)

    const target = '/' + locale + '/'
    res.render('redirect', { target: target }, (err, html) => {
      res.status(307)
      res.location(target)
      if (err) {
        res.type('text/plain; charset=utf-8')
        res.send(target)
        console.error(err.stack)
      } else {
        res.type('text/html; charset=utf-8')
        res.send(html)
      }
    })
  })
  app.all('/' + locale, returnBadAction)

  app.get('/' + locale + '/', (req, res) => {
    req.setLocale(locale)

    const localeHash = {}

    i18n.getLocales().forEach(locale => {
      localeHash[locale] = '/' + locale + '/'
    })

    res.render('index', { altLocales: getAltLocales(localeHash), subpages: sitemap.slice(0) })
  })
  app.all('/' + locale + '/', returnBadAction)
})

app.post('/user/update', (req, res) => {
  if (!res.locals.user) {
    res.status(403)
    res.type('application/json; charset=utf-8')
    res.send('{}')
  }

  const email = res.locals.user.email

  if (typeof req.body.name === 'string' && req.body.name !== '') {
    db.hset('user:' + email, 'name', req.body.name, err => {
      if (err) {
        throw err
      }
    })
  }

  if (typeof req.body.password === 'string' && req.body.password !== '' &&
    typeof req.body.newpassword === 'string' && req.body.newpassword !== '') {
    db.hget('user:' + email, 'password', (err, reply) => {
      if (err) {
        console.error(err.stack)
        return
      }

      if (typeof reply !== 'string' || reply === '') {
        // We still want to run bcrypt to avoid any timing attacks, because best practices.
        reply = ''
      }

      bcrypt.compare(req.body.password, reply, (err, match) => {
        if (err) {
          console.error(err.stack)
          return
        }

        if (!match) {
          return
        }

        bcrypt.hash(req.body.newpassword, 10, (err, hash) => {
          if (err) {
            console.error(err.stack)
            return
          }

          db.hset('user:' + email, 'password', hash, err => {
            if (err) {
              console.error(err.stack)
            }
          })
        })
      })
    })
  }

  // TODO Actually wait on the database.
  setTimeout(() => {
    res.status(200)
    res.type('application/json; charset=utf-8')
    res.send('{}')
  }, 10)
})
app.all('/user/update', returnBadAction)

const gatherApplications = (year, callback) => {
  if (typeof callback !== 'function') return

  if (typeof year === 'number') year = '' + year
  const parsedYear = parseInt(year, 10)
  if (isNaN(parsedYear) || '' + parsedYear !== year) {
    return callback(new Error('Expected year to be a number'), {})
  }

  db.keys('visa:' + year + ':*', (err, applications) => {
    if (err) {
      return callback(err, {})
    }

    async.map([ 'invited:' + year + ':veteran', 'invited:' + year + ':virgin' ], (key, callback) => {
      db.lrange(key, 0, 1000, callback)
    }, (err, invitees) => {
      if (err) {
        return callback(err, {})
      }

      invitees = invitees.reduce((array, current) => array.concat(Array.isArray(current) ? current : []), [])

      async.map([ 'queue:' + year + ':veteran', 'queue:' + year + ':virgin' ], (key, callback) => {
        db.lrange(key, 0, 1000, callback)
      }, (err, queuees) => {
        if (err) {
          return callback(err, {})
        }

        queuees = queuees.reduce((array, current) => array.concat(Array.isArray(current) ? current : []), [])

        async.map(applications.sort(), (key, callback) => {
          let email = key.substr(('visa:' + year + ':').length)
          db.hgetall(key, (err, application) => {
            if (err) {
              callback(err)
              return
            }

            let obj = { '__email': email }
            Object.keys(application).forEach(key => {
              try {
                if (obj) {
                  obj[key] = JSON.parse(application[key])
                }
              } catch (err) {
                obj = null
                callback(err)
              }
            })
            if (!obj) {
              return
            }

            obj['__virgin'] = ((obj['years-in-deja'] === 0 || obj['years-in-deja'] === '0') && obj['previous-burns'] === 'no') ? 'yes' : ''

            db.hget('user:' + email, 'answer.Enter DeJā.' + visaApplication[visaApplication.length - 1].title + '.' + year, (err, applicationtime) => {
              if (err) {
                console.error(err.message)
                applicationtime = null
              }

              if (typeof applicationtime === 'string') {
                let visaidInt = parseInt(applicationtime, 10)
                if (!isNaN(visaidInt) && ('' + visaidInt) === applicationtime) {
                  applicationtime = visaidInt
                }
              }
              if (typeof applicationtime !== 'number' || isNaN(applicationtime)) {
                applicationtime = ''
              } else {
                applicationtime = (new Date(applicationtime)).toUTCString()
              }

              if (typeof obj.email !== 'string' || obj.email === '') {
                obj.email = email
              } else if (typeof obj.email === 'string' && obj.email !== email) {
                obj.email += ' | ' + email
              }

              obj['__applicationtime'] = applicationtime

              if (invitees.indexOf(email) !== -1) {
                db.hget('user:' + email, 'visaid:' + year, (err, visaid) => {
                  if (err) {
                    console.error(err.message)
                    visaid = null
                  }

                  if (typeof visaid === 'string') {
                    let visaidInt = parseInt(visaid, 10)
                    if (!isNaN(visaidInt) && ('' + visaidInt) === visaid) {
                      visaid = visaidInt
                    }
                  }
                  if (typeof visaid !== 'number' && typeof visaid !== 'string') {
                    visaid = 'Being Assigned'
                  }

                  obj['__visaid'] = visaid
                  callback(null, obj)
                })
              } else if (queuees.indexOf(email) !== -1) {
                let queueNumber = '' + (queuees.indexOf(email) + 1)
                while (queueNumber.length < 3) queueNumber = '0' + queueNumber
                obj['__visaid'] = 'Queue #' + queueNumber
                callback(null, obj)
              } else {
                obj['__visaid'] = ''
                callback(null, obj)
              }
            })
          })
        }, (err, applications) => {
          if (err) {
            return callback(err, {})
          }

          applications = applications.sort((a, b) => {
            var viA = a['__visaid']
            var viB = b['__visaid']
            if (viA !== viB) {
              if (typeof viA === 'number' && typeof viB === 'number') return viA < viB ? -1 : 1
              else if (typeof viA === 'number') return -1
              else if (typeof viB === 'number') return 1
              else if (viA === '') return 1
              else if (viB === '') return -1
              else return viA < viB ? -1 : 1
            }

            var nsA = a['name-surname'].toLowerCase()
            var nsB = b['name-surname'].toLowerCase()
            if (nsA !== nsB) return nsA < nsB ? -1 : 1

            var nnA = a.nickname.toLowerCase()
            var nnB = b.nickname.toLowerCase()
            if (nnA !== nnB) return nnA < nnB ? -1 : 1

            return 0
          })

          const applicationsHeader = visaApplication.reduce((prev, next) => prev.concat(next.questions), [
            {
              'id': '__visaid',
              'title': 'Visa ID',
              'type': 'visaid'
            },
            {
              'id': '__virgin',
              'title': 'Virgin',
              'type': 'yes/no'
            }
          ]).concat([
            {
              'id': '__applicationtime',
              'title': 'Application Completion',
              'type': 'text'
            }
          ])

          let pages = {
            'Enter DeJā': [ applicationsHeader.map(question => question.title) ]
              .concat(applications
                .map(application => applicationsHeader.slice(0)
                  .map(question => application[question.id] || '')
                  .map(answer => Array.isArray(answer) ? answer.join(', ') : answer))),
            'Virgins': [ applicationsHeader.map(question => question.title) ]
              .concat(applications
                .filter(application => application['__virgin'])
                .map(application => applicationsHeader.slice(0)
                  .map(question => application[question.id] || '')
                  .map(answer => Array.isArray(answer) ? answer.join(', ') : answer))),
            'Veterans': [ applicationsHeader.map(question => question.title) ]
              .concat(applications
                .filter(application => !application['__virgin'])
                .map(application => applicationsHeader.slice(0)
                  .map(question => application[question.id] || '')
                  .map(answer => Array.isArray(answer) ? answer.join(', ') : answer))),
            'Health Issues': [ applicationsHeader.map(question => question.title) ]
              .concat(applications
                .filter(application => application['health-issues'] && application['health-issues'] !== 'no')
                .map(application => applicationsHeader.slice(0)
                  .map(question => application[question.id] || '')
                  .map(answer => Array.isArray(answer) ? answer.join(', ') : answer)))
          }

          applications.reduce((array, application) => {
            let applicationMinistries = application['ministry-choice']
            if (Array.isArray(applicationMinistries)) {
              applicationMinistries.forEach(ministry => {
                if (array.indexOf(ministry) === -1) {
                  array.push(ministry)
                }
              })
            }
            return array
          }, []).sort().forEach(ministry => {
            let pageName = ministry.replace(/[^A-z0-9(), ]/g, '').replace(/^Ministry of /i, '').split(')')[0].trim()
            while (pageName.indexOf('  ') !== -1) pageName = pageName.split('  ').join(' ')
            pageName = pageName.substr(0, 30)
            let ministryHeader = visaApplication.reduce((prev, next) => prev.concat(next.questions), [
              {
                'id': '__visaid',
                'title': 'Visa ID',
                'type': 'visaid'
              },
              {
                'id': '__virgin',
                'title': 'Virgin',
                'type': 'yes/no'
              }
            ]).filter(question => question.id !== 'ministry-choice')
            pages[pageName] = [ ministryHeader.map(question => question.title) ]
              .concat(applications.filter(application => {
                let applicationMinistries = application['ministry-choice']
                if (!Array.isArray(applicationMinistries) || applicationMinistries.indexOf(ministry) === -1) return false
                if (typeof application['__visaid'] !== 'number' && (typeof application['__visaid'] !== 'string' || application['__visaid'] === '')) return false
                return true
              }).map(application => ministryHeader.slice(0)
                .map(question => application[question.id] || '')
                .map(answer => Array.isArray(answer) ? answer.join(', ') : answer)))
          })

          callback(null, pages)
        })
      })
    })
  })
}

app.get('/x-admin/download-applications/:year', (req, res, next) => {
  if (!res.locals.user || !res.locals.user.admin) {
    next()
    return
  }

  const year = '' + req.params.year
  if (isNaN(parseInt(year, 10))) {
    res.status(400)
    res.type('text/plain; charset=utf-8')
    res.send('Year provided must be a number.')
    return
  }

  gatherApplications(year, (err, pages) => {
    if (err) {
      res.status(500)
      res.type('text/plain; charset=utf-8')
      res.send('Something broke horribly. Sorry.')
      console.error(err.stack)
      return
    }

    const book = xlsx.utils.book_new()
    Object.keys(pages).forEach(pageName => {
      const sheet = xlsx.utils.aoa_to_sheet(pages[pageName])

      xlsx.utils.book_append_sheet(book, sheet, pageName)

      if (typeof book.Sheets !== 'object' || book.Sheets === null) {
        console.error(`No sheets could not be found in the book. Ignoring.`)
      } else if (typeof book.Sheets[pageName] !== 'object' || book.Sheets[pageName] === null) {
        console.error(`Sheet ${pageName} could not be found in the book. Ignoring.`)
      } else {
        if (!Array.isArray(book.Sheets[pageName]['!cols'])) { book.Sheets[pageName]['!cols'] = [] }

        const header = pages[pageName][0] || []
        for (let i = 0; i < header.length; i++) {
          if (typeof book.Sheets[pageName]['!cols'][i] !== 'object' || book.Sheets[pageName]['!cols'][i] === null) { book.Sheets[pageName]['!cols'][i] = {} }
          book.Sheets[pageName]['!cols'][i].wch = typeof header[i] === 'string' ? Math.min(header[i].length, 30) : 15
        }
      }
    })

    res.status(200)
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename=enter-deja.' + year + '.xlsx')
    res.send(Buffer.from(xlsx.write(book, { bookType: 'xlsx', bookSST: true, type: 'base64' }), 'base64'))
  })
})
app.all('/x-admin/download-applications/:year', (req, res, next) => {
  if (!res.locals.user || !res.locals.user.admin) {
    next()
  } else {
    returnBadAction(req, res)
  }
});

(() => {
  const title = 'View Applications'

  const preprocess = (req, res) => {
    if (!res.locals.user) {
      const target = '/' + locale + '/' + req.__('Log In').toLowerCase().split(' ').join('-').split('/').join('-').split('(').join('').split(')').join('').split('!').join('') + '?l=' + req.url
      res.render('redirect', { target }, (err, html) => {
        res.status(303)
        res.location(target)
        if (err) {
          res.type('text/plain; charset=utf-8')
          res.send(target)
          console.error(err.stack)
        } else {
          res.type('text/html; charset=utf-8')
          res.send(html)
        }
      })
      return true
    } else if (!res.locals.user.admin) {
      res.render('403', { title: '403' }, (err, html) => {
        if (err) {
          res.status(500)
          res.type('text/plain; charset=utf-8')
          res.send('Something broke horribly. Sorry.')
          console.error(err.stack)
        } else {
          res.status(403)
          res.type('text/html; charset=utf-8')
          res.send(html)
        }
      })
      return true
    } else {
      return false
    }
  }

  const catchVisaApplications = locale => {
    app.get(encodeURI(localeHash[locale]), (req, res, next) => {
      req.setLocale(locale)

      if (preprocess(req, res)) {
        return
      }

      let redirectPeriod = getVisaPeriod()
      const periodStartDate = new Date(redirectPeriod - 1, 6, 1) // July 1
      if (+(periodStartDate) > Date.now()) { redirectPeriod-- }

      const target = encodeURI(localeHash[locale]) + '/' + redirectPeriod
      res.render('redirect', { target }, (err, html) => {
        res.status(303)
        res.location(target)
        if (err) {
          res.type('text/plain; charset=utf-8')
          res.send(target)
          console.error(err.stack)
        } else {
          res.type('text/html; charset=utf-8')
          res.send(html)
        }
      })
    })
    app.all(encodeURI(localeHash[locale]), returnBadAction)

    app.get(encodeURI(localeHash[locale] + '/:year'), (req, res) => {
      req.setLocale(locale)

      if (preprocess(req, res)) {
        return
      }

      gatherApplications('' + req.params.year, (err, pages) => {
        if (err) {
          res.status(500)
          res.type('text/plain; charset=utf-8')
          res.send('Something broke horribly. Sorry.')
          console.error(err.stack)
          return
        }

        const localeHashSuffixed = {}
        Object.keys(localeHash).forEach(lh => { localeHashSuffixed[lh] = encodeURI(localeHash[lh]) + '/' + encodeURIComponent(req.params.year) })

        res.render('view-applications', { altLocales: getAltLocales(localeHashSuffixed), title: req.__(title), markdown: '', year: '' + req.params.year, pages: Object.keys(pages) }, (err, html) => {
          if (err) {
            res.status(500)
            res.type('text/plain; charset=utf-8')
            res.send('Something broke horribly. Sorry.')
            console.error(err.stack)
          } else {
            res.status(200)
            res.type('text/html; charset=utf-8')
            res.send(html)
          }
        })
      })
    })
    app.all(encodeURI(localeHash[locale] + '/:year'), returnBadAction)

    app.get(encodeURI(localeHash[locale] + '/:year/'), (req, res) => {
      req.setLocale(locale)

      if (preprocess(req, res)) {
        return
      }

      const target = encodeURI(localeHash[locale]) + '/' + encodeURIComponent(req.params.year)
      res.render('redirect', { target }, (err, html) => {
        res.status(303)
        res.location(target)
        if (err) {
          res.type('text/plain; charset=utf-8')
          res.send(target)
          console.error(err.stack)
        } else {
          res.type('text/html; charset=utf-8')
          res.send(html)
        }
      })
    })
    app.all(encodeURI(localeHash[locale] + '/:year/'), returnBadAction)

    app.get(encodeURI(localeHash[locale] + '/:year/:pageNames'), (req, res) => {
      req.setLocale(locale)

      if (preprocess(req, res)) {
        return
      }

      gatherApplications('' + req.params.year, (err, pages) => {
        if (err) {
          res.status(500)
          res.type('text/plain; charset=utf-8')
          res.send('Something broke horribly. Sorry.')
          console.error(err.stack)
          return
        }

        const localeHashSuffixed = {}
        Object.keys(localeHash).forEach(lh => { localeHashSuffixed[lh] = encodeURI(localeHash[lh]) + '/' + encodeURIComponent(req.params.year) + '/' + encodeURIComponent(req.params.pageNames) })

        Object.keys(pages).filter(pageName => req.params.pageNames.split('!').indexOf(req.__(pageName).toLowerCase().split(' ').join('-').split('/').join('-').split('(').join('').split(')').join('').split('!').join('')) === -1).forEach(pageName => { delete pages[pageName] })

        res.render('view-applications', { altLocales: getAltLocales(localeHashSuffixed), title: req.__(title), markdown: '', year: '' + req.params.year, pages }, (err, html) => {
          if (err) {
            res.status(500)
            res.type('text/plain; charset=utf-8')
            res.send('Something broke horribly. Sorry.')
            console.error(err.stack)
          } else {
            res.status(200)
            res.type('text/html; charset=utf-8')
            res.send(html)
          }
        })
      })
    })
    app.all(encodeURI(localeHash[locale] + '/:year/:pageName'), returnBadAction)
  }

  const navbarHash = {}
  const localeHash = {}

  i18n.__h(title).forEach(subhash => {
    for (var locale in subhash) {
      if (!subhash.hasOwnProperty(locale)) { continue }
      navbarHash[locale] = subhash[locale]
      localeHash[locale] = '/' + locale + '/' + navbarHash[locale].toLowerCase().split(' ').join('-').split('/').join('-').split('(').join('').split(')').join('').split('!').join('')
    }
  })

  for (var locale in navbarHash) {
    if (!navbarHash.hasOwnProperty(locale)) { continue }
    catchVisaApplications(locale)
  }
})();

(() => {
  const title = 'Log In'

  const catchLogin = locale => {
    app.get(encodeURI(localeHash[locale]), (req, res) => {
      req.setLocale(locale)
      const emailCheck = req.query.email === 'check'
      const location = (typeof req.query.l === 'string' && url.parse('https://xn--dej-3oa.lv' + req.query.l).path === req.query.l ? req.query.l : '') ||
        (req.body ? req.body.location : '') || ('/' + locale + '/')

      res.render('log-in', { altLocales: getAltLocales(localeHash), title: req.__(title), markdown: '', hideNavigation: true, location: location, emailCheck: emailCheck }, (err, html) => {
        if (err) {
          res.status(500)
          res.type('text/plain; charset=utf-8')
          res.send('Something broke horribly. Sorry.')
          console.error(err.stack)
        } else {
          res.status(200)
          res.type('text/html; charset=utf-8')
          res.send(html)
        }
      })
    })
    app.post(encodeURI(localeHash[locale]), (req, res) => {
      req.setLocale(locale)
      const email = req.body ? typeof req.body.email === 'string' ? req.body.email.toLowerCase() : '' : ''
      const password = req.body ? req.body.password : ''
      const location = (req.body ? req.body.location : '') || ('/' + locale + '/')

      const rerender = err => {
        res.render('log-in', { altLocales: getAltLocales(localeHash), title: req.__(title), markdown: '', hideNavigation: true, location: location, err: err, email: email }, (err, html) => {
          if (err) {
            res.status(500)
            res.type('text/plain; charset=utf-8')
            res.send('Something broke horribly. Sorry.')
            console.error(err.stack)
          } else {
            res.status(200)
            res.type('text/html; charset=utf-8')
            res.send(html)
          }
        })
      }

      if (typeof email !== 'string' || email === '' || typeof password !== 'string' || password === '') {
        rerender(new Error('No e-mail and password combination provided.'))
        return
      }

      db.hget('user:' + email, 'password', (err, reply) => {
        if (err) {
          console.error(err.stack)
        }

        if (typeof reply !== 'string' || reply === '') {
          // We still want to run bcrypt to avoid any timing attacks, because best practices.
          reply = ''
        }

        bcrypt.compare(password, reply, (err, match) => {
          if (err) {
            rerender(new Error('Internal validation error encountered.'))
            console.error(err.stack)
            return
          }

          if (!match) {
            rerender(new Error('Incorrect e-mail and password combination provided.'))
            return
          }

          const token = randomstring.generate({ length: 32, charset: 'alphanumeric' })
          // Remember to keep the expiry in sync with what `privacy-policy.md` states!
          const tokenExpirySeconds = 60/* s */ * 60/* m */ * 3/* h */
          db.setex('session:' + token, tokenExpirySeconds, email, err => {
            if (err) {
              rerender(new Error('Internal database error encountered.'))
              console.error(err.stack)
              return
            }

            res.cookie('token', token, { path: '/', maxAge: 1000 * tokenExpirySeconds, httpOnly: true, secure: true, sameSite: 'Strict' })

            res.render('redirect', { target: location }, (err, html) => {
              res.status(303)
              res.location(location)
              if (err) {
                res.type('text/plain; charset=utf-8')
                res.send(location)
                console.error(err.stack)
              } else {
                res.type('text/html; charset=utf-8')
                res.send(html)
              }
            })
          })
        })
      })
    })
    app.all(encodeURI(localeHash[locale]), returnBadAction)
  }

  const navbarHash = {}
  const localeHash = {}

  i18n.__h(title).forEach(subhash => {
    for (var locale in subhash) {
      if (!subhash.hasOwnProperty(locale)) { continue }
      navbarHash[locale] = subhash[locale]
      localeHash[locale] = '/' + locale + '/' + navbarHash[locale].toLowerCase().split(' ').join('-').split('/').join('-').split('(').join('').split(')').join('').split('!').join('')
    }
  })

  for (var locale in navbarHash) {
    if (!navbarHash.hasOwnProperty(locale)) { continue }
    catchLogin(locale)
  }
})();

(() => {
  const title = 'Log Out'

  const catchLogout = locale => {
    app.get(encodeURI(localeHash[locale]), (req, res) => {
      req.setLocale(locale)
      const location = (req.body ? req.body.location : '') || (req.headers ? req.headers.referer : '') || ('/' + locale + '/')
      res.cookie('token', '', { path: '/', maxAge: 1, httpOnly: true, secure: true, sameSite: 'Strict' })
      res.render('redirect', { target: location }, (err, html) => {
        res.status(303)
        res.location(location)
        if (err) {
          res.type('text/plain; charset=utf-8')
          res.send(location)
          console.error(err.stack)
        } else {
          res.type('text/html; charset=utf-8')
          res.send(html)
        }
      })
    })
    app.all(encodeURI(localeHash[locale]), returnBadAction)
  }

  const navbarHash = {}
  const localeHash = {}

  i18n.__h(title).forEach(subhash => {
    for (var locale in subhash) {
      if (!subhash.hasOwnProperty(locale)) { continue }
      navbarHash[locale] = subhash[locale]
      localeHash[locale] = '/' + locale + '/' + navbarHash[locale].toLowerCase().split(' ').join('-').split('/').join('-').split('(').join('').split(')').join('').split('!').join('')
    }
  })

  for (var locale in navbarHash) {
    if (!navbarHash.hasOwnProperty(locale)) { continue }
    catchLogout(locale)
  }
})();

(() => {
  const title = 'Create account'

  const catchCreateAccount = locale => {
    app.get(encodeURI(localeHash[locale]), (req, res) => {
      req.setLocale(locale)

      res.render('create-account', { altLocales: getAltLocales(localeHash), title: req.__(title), markdown: '', hideNavigation: true }, (err, html) => {
        if (err) {
          res.status(500)
          res.type('text/plain; charset=utf-8')
          res.send('Something broke horribly. Sorry.')
          console.error(err.stack)
        } else {
          res.status(200)
          res.type('text/html; charset=utf-8')
          res.send(html)
        }
      })
    })
    app.post(encodeURI(localeHash[locale]), (req, res) => {
      req.setLocale(locale)
      const name = req.body ? req.body.name : ''
      const email = req.body ? typeof req.body.email === 'string' ? req.body.email.toLowerCase() : '' : ''
      const location = '/' + locale + '/' + req.__('Log In').toLowerCase().split(' ').join('-').split('/').join('-').split('(').join('').split(')').join('').split('!').join('') + '?email=check'

      const rerender = err => {
        res.render('create-account', { altLocales: getAltLocales(localeHash), title: req.__(title), markdown: '', hideNavigation: true, err: err, name: name, email: email }, (err, html) => {
          if (err) {
            res.status(500)
            res.type('text/plain; charset=utf-8')
            res.send('Something broke horribly. Sorry.')
            console.error(err.stack)
          } else {
            res.status(200)
            res.type('text/html; charset=utf-8')
            res.send(html)
          }
        })
      }

      if (typeof name !== 'string' || name === '' || typeof email !== 'string' || email === '') {
        rerender(new Error('No name and e-mail combination provided.'))
        return
      }

      const password = randomstring.generate({ length: 8, readable: true, charset: 'alphanumeric' })

      bcrypt.hash(password, 10, (err, hash) => {
        if (err) {
          rerender(new Error('Internal validation error encountered.'))
          console.error(err.stack)
          return
        }

        // This is a stub for allowing 'do not email me' functionality.
        db.hexists('user:' + email, 'nopassword', (err, nreply) => {
          if (err) {
            rerender(new Error('Internal database error encountered.'))
            console.error(err.stack)
            return
          }

          if (nreply) {
            res.render('redirect', { target: location }, (err, html) => {
              res.status(303)
              res.location(location)
              if (err) {
                res.type('text/plain; charset=utf-8')
                res.send(location)
                console.error(err.stack)
              } else {
                res.type('text/html; charset=utf-8')
                res.send(html)
              }
            })
            return
          }

          db.hexists('user:' + email, 'password', (err, preply) => {
            if (err) {
              rerender(new Error('Internal database error encountered.'))
              console.error(err.stack)
              return
            }

            db.hmset('user:' + email, { password: hash, name: name }, err => {
              if (err) {
                rerender(new Error('Internal database error encountered.'))
                console.error(err.stack)
                return
              }

              app.render(preply ? 'email-passwordreset' : 'email-passwordnew', { password: password }, (err, html) => {
                mailgun.messages().send({
                  from: 'Degošie Jāņi <game@sparklatvia.lv>',
                  to: email,
                  subject: 'Your registration with DeJā',
                  text: 'Welcome!' + '\n\n' +
                    'Your ' + (preply ? 'new ' : '') + 'password is ' + password + '.' + '\n\n' +
                    'If you did not register for anything, just ignore this message.',
                  html: err ? undefined : html
                }, err => {
                  if (err) {
                    rerender(new Error('Internal dispatching error encountered.'))
                    console.error(err.stack)
                    return
                  }

                  res.render('redirect', { target: location }, (err, html) => {
                    res.status(303)
                    res.location(location)
                    if (err) {
                      res.type('text/plain; charset=utf-8')
                      res.send(location)
                      console.error(err.stack)
                    } else {
                      res.type('text/html; charset=utf-8')
                      res.send(html)
                    }
                  })
                })
              })
            })
          })
        })
      })
    })
    app.all(encodeURI(localeHash[locale]), returnBadAction)
  }

  const navbarHash = {}
  const localeHash = {}

  i18n.__h(title).forEach(subhash => {
    for (var locale in subhash) {
      if (!subhash.hasOwnProperty(locale)) { continue }
      navbarHash[locale] = subhash[locale]
      localeHash[locale] = '/' + locale + '/' + navbarHash[locale].toLowerCase().split(' ').join('-').split('/').join('-').split('(').join('').split(')').join('').split('!').join('')
    }
  })

  for (var locale in navbarHash) {
    if (!navbarHash.hasOwnProperty(locale)) { continue }
    catchCreateAccount(locale)
  }
})()

function catchAllFor (backstack, sitemap) {
  if (!Array.isArray(sitemap)) { sitemap = [] }
  sitemap.forEach(page => {
    if (typeof page.title !== 'string') { throw new Error('Page title not provided as a string.') }
    if (!Array.isArray(page.subpages)) { page.subpages = [] }
    if (typeof page.render !== 'object' || page.render === null) { page.render = {} }

    const stack = JSON.parse(JSON.stringify(backstack))
    stack[stack.length] = { title: {}, href: {}, render: page.render }

    const reduceToHref = locale => {
      return stack.reduce((prev, next) => prev + '/' + next.title[locale].toLowerCase().split(' ').join('-').split('/').join('-').split('(').join('').split(')').join('').split('!').join(''), '/' + locale)
    }

    i18n.__h(page.title).forEach(subhash => {
      for (var locale in subhash) {
        if (!subhash.hasOwnProperty(locale)) { continue }
        stack[stack.length - 1].title[locale] = subhash[locale]
        stack[stack.length - 1].href[locale] = reduceToHref(locale)
      }
    })

    page.questions = {}
    if (page.type === 'questions') {
      page.questions = questions
      stack.forEach(item => {
        if (typeof page.questions !== 'object' || page.questions === null) { page.questions = {} }
        page.questions = page.questions[item.title.en]
      })
      if (typeof page.questions !== 'object' || page.questions === null) { page.questions = {} }
    } else if (page.type === 'enter-deja') {
      page.questions = visaApplication.filter(section => section.title === page.title)[0]
      if (typeof page.questions !== 'object' || page.questions === null) { page.questions = {} }
    }

    if (!page.hidden) {
      const catchAll = (localeHash, locale, view, title, renderOverrides) => {
        app.get(encodeURI(localeHash[locale]), (req, res) => {
          req.setLocale(locale)
          if (!res.locals.acl(page.acl)) {
            const target = res.locals.user
              ? page.render.previouspage
                ? stack.slice(0, -1).reduce((prev, next) => prev +
                  '/' + next.title[locale].toLowerCase().split(' ').join('-').split('/').join('-').split('(').join('').split(')').join('').split('!').join(''), '/' + locale) +
                    '/' + req.__(page.render.previouspage).toLowerCase().split(' ').join('-').split('/').join('-').split('(').join('').split(')').join('').split('!').join('')
                : '/' + locale + '/'
              : '/' + locale + '/' + req.__('Log In').toLowerCase().split(' ').join('-').split('/').join('-').split('(').join('').split(')').join('').split('!').join('') + '?l=' + req.url
            res.render('redirect', { target: target }, (err, html) => {
              res.status(303)
              res.location(target)
              if (err) {
                res.type('text/plain; charset=utf-8')
                res.send(target)
                console.error(err.stack)
              } else {
                res.type('text/html; charset=utf-8')
                res.send(html)
              }
            })
            return
          }
          const preroute = callback => {
            if (page.type === 'questions') {
              if (!res.locals.user) {
                callback(null, false)
                return
              }

              const field = stack.reduce((prev, next) => prev + '.' + next.title.en, 'answer')
              if (res.locals.user[field]) {
                const target = '/' + locale + '/' + page.questions.nextPage
                  .map(part => req.__(part).toLowerCase().split(' ').join('-').split('/').join('-').split('(').join('').split(')').join('').split('!').join('')).join('/')
                res.render('redirect', { target: target }, (err, html) => {
                  res.status(303)
                  res.location(target)
                  if (err) {
                    res.type('text/plain; charset=utf-8')
                    res.send(target)
                    console.error(err.stack)
                  } else {
                    res.type('text/html; charset=utf-8')
                    res.send(html)
                  }
                })
                callback(null, true)
              } else {
                callback(null, false)
              }
            } else if (page.type === 'enter-deja') {
              if (!res.locals.user) {
                callback(null, false)
                return
              }

              if (+(new Date(getVisaPeriod() - 1, 6, 1)) > Date.now()) { // July 1
                // It is not July 1 yet so no new applications!
                res.render('403', { title: '403', message: req.__('Portal is closed. Take the next shuttle.') }, (err, html) => {
                  if (err) {
                    res.status(500)
                    res.type('text/plain; charset=utf-8')
                    res.send('Something broke horribly. Sorry.')
                    console.error(err.stack)
                  } else {
                    res.status(403)
                    res.type('text/html; charset=utf-8')
                    res.send(html)
                  }
                })
                callback(null, true)
                return
              }

              const field = stack.reduce((prev, next) => prev + '.' + next.title.en, 'answer')
              if (res.locals.user[field]) {
                const target = (stack.slice(0, -1).reduce((prev, next) => prev +
                  '/' + next.title[locale].toLowerCase().split(' ').join('-').split('/').join('-').split('(').join('').split(')').join('').split('!').join(''), '/' + locale) +
                    '/' + req.__(page.render.nextpage).toLowerCase().split(' ').join('-').split('/').join('-').split('(').join('').split(')').join('').split('!').join(''))
                res.render('redirect', { target: target }, (err, html) => {
                  res.status(303)
                  res.location(target)
                  if (err) {
                    res.type('text/plain; charset=utf-8')
                    res.send(target)
                    console.error(err.stack)
                  } else {
                    res.type('text/html; charset=utf-8')
                    res.send(html)
                  }
                })
                callback(null, true)
              } else {
                callback(null, false)
              }
            } else {
              callback(null, false)
            }
          }
          const prerender = callback => {
            const setViewStatus = () => {
              if (!res.locals.user) {
                callback(null)
                return
              }

              const field = stack.reduce((prev, next) => prev + '.' + next.title.en, 'view')
              const value = Date.now()
              db.hsetnx('user:' + res.locals.user.email, field, value, err => {
                if (err) {
                  callback(err)
                  return
                }

                res.locals.user[field] = value
                callback(null)
              })
            }

            if (page.type === 'questions') {
              if (!res.locals.user) {
                callback(new Error('No user to assign question choices to.'))
                return
              }

              const field = stack.reduce((prev, next) => prev + '.' + next.title.en, 'questions')
              if (res.locals.user[field]) {
                try {
                  res.locals.questions = JSON.parse(res.locals.user[field])
                } catch (err) {
                  callback(err)
                  return
                }
                setViewStatus()
              } else {
                res.locals.questions = shuffle(page.questions.questions.slice(0)).splice(0, 2)
                const value = JSON.stringify(res.locals.questions)
                db.hsetnx('user:' + res.locals.user.email, field, value, (err, reply) => {
                  if (err) {
                    callback(err)
                    return
                  }

                  if (reply === 1) {
                    res.locals.user[field] = value
                    setViewStatus()
                  } else if (reply === 0) {
                    db.hget('user:' + res.locals.user.email, field, (err, reply) => {
                      if (err) {
                        callback(err)
                      }

                      if (typeof reply !== 'string' || reply === '') {
                        db.hset('user:' + res.locals.user.email, field, value, err => callback(err))
                        return
                      }

                      res.locals.user[field] = reply
                      try {
                        res.locals.questions = JSON.parse(reply)
                      } catch (err) {
                        callback(err)
                        return
                      }
                      setViewStatus()
                    })
                  } else {
                    callback(new Error('Unexpected return value from HSETNX.'))
                  }
                })
              }
            } else if (page.type === 'enter-deja') {
              res.locals.questions = page.questions.questions.slice(0)
              setViewStatus()
            } else {
              setViewStatus()
            }
          }
          const render = markdown => {
            preroute((err, intercepted) => {
              if (err || intercepted) { return }

              prerender(err => {
                if (err) {
                  res.status(500)
                  res.type('text/plain; charset=utf-8')
                  res.send('Something broke horribly. Sorry.')
                  console.error(err.stack)
                  return
                }

                const renderParams = Object.assign({
                  altLocales: getAltLocales(localeHash),
                  title: title,
                  origTitle: stack[stack.length - 1].title.en,
                  stackpages: stack.map(el => el.title[locale]),
                  subpages: page.subpages.filter(page => page.type !== 'questions'),
                  siblingpages: sitemap.filter(page => page.type !== 'questions'),
                  markdown: markdown
                }, renderOverrides || {})
                res.render(encodeURIComponent(page.type || view.split('.')[0]), renderParams, (err, html) => {
                  if (err) {
                    res.render('layout', renderParams, (err, html) => {
                      if (err) {
                        res.status(500)
                        res.type('text/plain; charset=utf-8')
                        res.send('Something broke horribly. Sorry.')
                        console.error(err.stack)
                      } else {
                        res.status(200)
                        res.type('text/html; charset=utf-8')
                        res.send(html)
                      }
                    })
                  } else {
                    res.status(200)
                    res.type('text/html; charset=utf-8')
                    res.send(html)
                  }
                })
              })
            })
          }
          fs.readFile(path.join(__dirname, 'pages', locale, encodeURIComponent(view + '.md')), { encoding: 'utf8' }, (err, data) => {
            if (err) {
              fs.readFile(path.join(__dirname, 'pages', 'en', encodeURIComponent(view + '.md')), { encoding: 'utf8' }, (err, data) => {
                if (err) {
                  render('')
                } else {
                  render(showdown.makeHtml(frontMatter(data).body.trim()).split('\n').join(''))
                }
              })
            } else {
              render(showdown.makeHtml(frontMatter(data).body.trim()).split('\n').join(''))
            }
          })
        })
        if (page.type === 'questions') {
          app.post(encodeURI(localeHash[locale]), (req, res) => {
            const field = stack.reduce((prev, next) => prev + '.' + next.title.en, 'questions')
            if (!res.locals.user || !res.locals.user[field]) {
              const target = '/' + locale + '/' + req.__('Log In').toLowerCase().split(' ').join('-').split('/').join('-').split('(').join('').split(')').join('').split('!').join('') + '?l=' + req.url
              res.render('redirect', { target: target }, (err, html) => {
                res.status(303)
                res.location(target)
                if (err) {
                  res.type('text/plain; charset=utf-8')
                  res.send(target)
                  console.error(err.stack)
                } else {
                  res.type('text/html; charset=utf-8')
                  res.send(html)
                }
              })
              return
            }

            try {
              res.locals.questions = JSON.parse(res.locals.user[field])
            } catch (err) {
              res.status(500)
              res.type('text/plain; charset=utf-8')
              res.send('Something broke horribly. Sorry.')
              console.error(err.stack)
              return
            }

            const rerender = () => {
              const target = req.url
              res.render('redirect', { target: target }, (err, html) => {
                res.status(303)
                res.location(target)
                if (err) {
                  res.type('text/plain; charset=utf-8')
                  res.send(target)
                  console.error(err.stack)
                } else {
                  res.type('text/html; charset=utf-8')
                  res.send(html)
                }
              })
            }

            for (let i = 0; i < res.locals.questions.length; i++) {
              if (res.locals.questions[i].question !== req.body['q' + i]) {
                rerender()
                return
              }

              let expectedAnswer = res.locals.questions[i].expectedAnswer
              if (expectedAnswer === null) { expectedAnswer = res.locals.questions[i].answers }
              let actualAnswer = req.body['a' + i]

              if (Array.isArray(expectedAnswer)) {
                if (!Array.isArray(actualAnswer) || actualAnswer.length === 0) {
                  rerender()
                  return
                }

                for (let j = 0; j < actualAnswer.length; j++) {
                  if (expectedAnswer.indexOf(actualAnswer[j]) === -1) {
                    rerender()
                    return
                  }
                }
              } else if (actualAnswer !== expectedAnswer) {
                rerender()
                return
              }
            }

            const fieldAns = stack.reduce((prev, next) => prev + '.' + next.title.en, 'answer')
            const valueAns = Date.now()
            db.hsetnx('user:' + res.locals.user.email, fieldAns, valueAns, err => {
              if (err) {
                res.status(500)
                res.type('text/plain; charset=utf-8')
                res.send('Something broke horribly. Sorry.')
                console.error(err.stack)
                return
              }

              res.locals.user[fieldAns] = valueAns

              const target = '/' + locale + '/' + page.questions.nextPage
                .map(part => req.__(part).toLowerCase().split(' ').join('-').split('/').join('-').split('(').join('').split(')').join('').split('!').join('')).join('/')
              res.render('redirect', { target: target }, (err, html) => {
                res.status(303)
                res.location(target)
                if (err) {
                  res.type('text/plain; charset=utf-8')
                  res.send(target)
                  console.error(err.stack)
                } else {
                  res.type('text/html; charset=utf-8')
                  res.send(html)
                }
              })
            })
          })
        } else if (page.type === 'enter-deja') {
          app.post(encodeURI(localeHash[locale]), (req, res) => {
            if (!res.locals.user) {
              res.status(400)
              res.type('text/plain; charset=utf-8')
              res.send('WHO_ARE_YOU')
              return
            }

            const rerender = () => {
              const target = req.url
              res.render('redirect', { target: target }, (err, html) => {
                res.status(303)
                res.location(target)
                if (err) {
                  res.type('text/plain; charset=utf-8')
                  res.send(target)
                  console.error(err.stack)
                } else {
                  res.type('text/html; charset=utf-8')
                  res.send(html)
                }
              })
            }

            if (+(new Date(getVisaPeriod() - 1, 6, 1)) > Date.now()) { // July 1
              // It is not July 1 yet so no new applications!
              res.render('403', { title: '403', message: req.__('Portal is closed. Take the next shuttle.') }, (err, html) => {
                if (err) {
                  res.status(500)
                  res.type('text/plain; charset=utf-8')
                  res.send('Something broke horribly. Sorry.')
                  console.error(err.stack)
                } else {
                  res.status(403)
                  res.type('text/html; charset=utf-8')
                  res.send(html)
                }
              })
              return
            }

            const h = {}

            res.locals.questions = page.questions.questions.slice(0)
            for (let i = 0; i < res.locals.questions.length; i++) {
              let id = res.locals.questions[i].id
              let ans = typeof req.body[id] === 'string' || Array.isArray(req.body[id]) ? req.body[id] : ''

              switch (res.locals.questions[i].type) {
                case 'text':
                case 'date':
                case 'country':
                  if (typeof ans !== 'string') {
                    rerender()
                    return
                  }
                  h[id] = JSON.stringify(ans)
                  break
                case 'email':
                  if (typeof ans !== 'string') {
                    rerender()
                    return
                  }
                  ans = ans.toLowerCase()
                  if (ans !== res.locals.user.email) {
                    rerender()
                    return
                  }
                  h[id] = JSON.stringify(ans)
                  break
                case 'single':
                  if (typeof ans !== 'string' || res.locals.questions[i].answers.indexOf(ans) === -1) {
                    rerender()
                    return
                  }
                  h[id] = JSON.stringify(ans)
                  break
                case 'multiple':
                  if (typeof ans === 'string') {
                    ans = [ ans ]
                  }
                  if (!Array.isArray(ans)) {
                    rerender()
                    return
                  }
                  for (var j = 0; j < ans.length; j++) {
                    if (res.locals.questions[i].answers.indexOf(ans[j]) === -1) {
                      rerender()
                      return
                    }
                  }
                  h[id] = JSON.stringify(ans)
                  break
                case 'yes/no':
                case 'yes/no;textifyes':
                case 'yes/no;textifno':
                  if (ans !== 'yes' && ans !== 'no') {
                    rerender()
                    return
                  }
                  const textif = res.locals.questions[i].type.split(';')
                    .filter(part => part.startsWith('textif'))
                    .map(part => part.substr('textif'.length))
                    .reduce((prev, next) => prev + next, '')
                  if (ans === textif) {
                    let exp = typeof req.body[id + '.explanation'] === 'string' ? req.body[id + '.explanation'] : ''
                    if (typeof exp !== 'string' || exp === '') {
                      rerender()
                      return
                    }

                    h[id] = JSON.stringify(ans + ': ' + exp)
                  } else {
                    h[id] = JSON.stringify(ans)
                  }
                  break
              }
            }

            const moveForward = () => {
              const target = stack.slice(0, -1).reduce((prev, next) => prev +
                '/' + next.title[locale].toLowerCase().split(' ').join('-').split('/').join('-').split('(').join('').split(')').join('').split('!').join(''), '/' + locale) +
                  '/' + req.__(page.render.nextpage).toLowerCase().split(' ').join('-').split('/').join('-').split('(').join('').split(')').join('').split('!').join('')
              res.render('redirect', { target: target }, (err, html) => {
                res.status(303)
                res.location(target)
                if (err) {
                  res.type('text/plain; charset=utf-8')
                  res.send(target)
                  console.error(err.stack)
                } else {
                  res.type('text/html; charset=utf-8')
                  res.send(html)
                }
              })
            }

            const visaPeriod = '' + getVisaPeriod()
            const fieldAns = stack.reduce((prev, next) => prev + '.' + next.title.en, 'answer') + '.' + visaPeriod
            db.hget('user:' + res.locals.user.email, fieldAns, (err, reply) => {
              if (err) {
                res.status(500)
                res.type('text/plain; charset=utf-8')
                res.send('Something broke horribly. Sorry.')
                console.error(err.stack)
                return
              }

              if ((typeof reply === 'string' || typeof reply === 'number') && reply !== '' && reply !== 0) {
                moveForward()
                return
              }

              db.hmset('visa:' + visaPeriod + ':' + res.locals.user.email, h, err => {
                if (err) {
                  res.status(500)
                  res.type('text/plain; charset=utf-8')
                  res.send('Something broke horribly. Sorry.')
                  console.error(err.stack)
                  return
                }

                db.hgetall('visa:' + visaPeriod + ':' + res.locals.user.email, (err, application) => {
                  if (err) {
                    res.status(500)
                    res.type('text/plain; charset=utf-8')
                    res.send('Something broke horribly. Sorry.')
                    console.error(err.stack)
                    return
                  }

                  const setUserField = () => {
                    const valueAns = Date.now()
                    db.hsetnx('user:' + res.locals.user.email, fieldAns, valueAns, err => {
                      if (err) {
                        res.status(500)
                        res.type('text/plain; charset=utf-8')
                        res.send('Something broke horribly. Sorry.')
                        console.error(err.stack)
                        return
                      }

                      res.locals.user[fieldAns] = valueAns

                      moveForward()
                    })
                  }

                  const virgin = (application['previous-burns'] === 'no' || application['previous-burns'] === '"no"') &&
                    (application['years-in-deja'] === 0 || application['years-in-deja'] === '0' || application['years-in-deja'] === '"0"')

                  if (page.render.nextpage === 'Status') {
                    // After finishing the application form, the user is pushed to the main queue for processing.
                    db.rpush('queue:' + visaPeriod + ':' + (virgin ? 'virgin' : 'veteran'), res.locals.user.email, err => {
                      if (err) {
                        res.status(500)
                        res.type('text/plain; charset=utf-8')
                        res.send('Something broke horribly. Sorry.')
                        console.error(err.stack)
                        return
                      }

                      if (virgin) {
                        // Virgins get an additional e-mail notification since they may end up on a waiting queue.

                        const aemail = typeof application.email === 'string' ? JSON.parse(application.email) : application.email
                        if (typeof aemail !== 'string' || aemail === '') {
                          res.status(500)
                          res.type('text/plain; charset=utf-8')
                          res.send('Something broke horribly. Sorry.')
                          console.error(err.stack)
                          return
                        }

                        app.render('email-entry-psbqueue', { visaPeriod }, (err, html) => {
                          mailgun.messages().send({
                            from: 'Degošie Jāņi <game@sparklatvia.lv>',
                            to: aemail,
                            subject: 'Your entry status for DeJā ' + visaPeriod,
                            text: 'Thank you for your submission!' + '\n\n' +
                              'You will be receiving another email with more information.',
                            html: err ? undefined : html
                          }, err => {
                            if (err) {
                              console.error(err.stack)
                            }
                          })
                        })
                      }

                      setUserField()
                    })
                  } else {
                    setUserField()
                  }
                })
              })
            })
          })
        }
        app.all(encodeURI(localeHash[locale]), returnBadAction)
      }

      for (var locale in stack[stack.length - 1].title) {
        if (!stack[stack.length - 1].title.hasOwnProperty(locale)) { continue }
        catchAll(stack[stack.length - 1].href, locale,
          stack.map(el => el.title.en.toLowerCase().split(' ').join('-').split('/').join('-').split('(').join('').split(')').join('').split('!').join('')).join('.'),
          stack[stack.length - 1].title[locale], stack[stack.length - 1].render)
      }
    } else if (typeof page.hidden === 'string') {
      const catchAllRedirect = (hash, locale, target) => {
        app.get(encodeURI(hash), (req, res) => {
          req.setLocale(locale)
          res.render('redirect', { target: target }, (err, html) => {
            res.status(303)
            res.location(target)
            if (err) {
              res.type('text/plain; charset=utf-8')
              res.send(target)
              console.error(err.stack)
            } else {
              res.type('text/html; charset=utf-8')
              res.send(html)
            }
          })
        })
        app.all(encodeURI(hash), returnBadAction)
      }

      for (var localeRedirect in stack[stack.length - 1].title) {
        if (!stack[stack.length - 1].title.hasOwnProperty(localeRedirect)) { continue }
        catchAllRedirect(stack[stack.length - 1].href[localeRedirect], localeRedirect, stack[stack.length - 1].href[localeRedirect] + '/' +
          i18n.__({ phrase: page.hidden, locale: localeRedirect }).toLowerCase().split(' ').join('-').split('/').join('-').split('(').join('').split(')').join('').split('!').join(''))
      }
    }

    catchAllFor(stack, page.subpages)
  })
}
catchAllFor([], sitemap.slice(0))

var cssCache = null
const renderLess = callback => {
  fs.readFile(path.join(__dirname, 'less', 'main.less'), { encoding: 'utf8' }, (err, data) => {
    if (err) {
      callback(err, null)
    } else {
      less.render(data, {
        'include-path': [ path.join(__dirname, 'less') ],
        plugins: [ lessCleanCss ]
      }).then(out => {
        callback(null, out.css + '\n')
      }, err => {
        callback(err, null)
      })
    }
  })
}
renderLess((err, css) => {
  if (err) {
    cssCache = null
  } else {
    cssCache = css
  }
})
app.get('/main.css', (req, res) => {
  if (env === 'dev') {
    renderLess((err, css) => {
      if (err) {
        res.status(500)
        res.type('text/css; charset=utf-8')
        res.send('/* Error reading file: ' + (err.code || err.type || 'OOPS') + ' */\n')
      } else {
        res.status(200)
        res.type('text/css; charset=utf-8')
        res.send(css)
      }
    })
    return
  }

  res.status(cssCache ? 200 : 500)
  res.type('text/css; charset=utf-8')
  res.send(cssCache || '/* Failed to read the styles. */\n')
})
app.all('/main.css', returnBadAction)

app.use((req, res) => {
  res.render('404', { title: '404' }, (err, html) => {
    if (err) {
      res.status(500)
      res.type('text/plain; charset=utf-8')
      res.send('Something broke horribly. Sorry.')
      console.error(err.stack)
    } else {
      res.status(404)
      res.type('text/html; charset=utf-8')
      res.send(html)
    }
  })
})

let pfx = null
try {
  pfx = fs.readFileSync(path.join(__dirname, 'cert.pfx'), { encoding: null })
} catch (err) {
  pfx = null
  if (err.code !== 'ENOENT') {
    throw err
  }
}

const server = pfx ? https.createServer({ pfx: pfx, passphrase: 'node' }, app).listen(app.get('port')) : app.listen(app.get('port'))
module.exports = server

process.once('SIGINT', () => {
  server.once('close', () => {
    console.log('Server clean-up finished.')
    process.exit(0)
  })
  server.close()
  server.getConnections((err, count) => {
    if (err) {
      console.error(err.stack)
      process.exit(1)
    }
    if (count > 0) {
      console.log('Waiting for ' + count + ' open connections to close themselves.')
    }
  })

  process.on('SIGINT', () => {
    console.log('Forcing the server shut-down.')
    process.exit(0)
  })
})

const slack = (method, args, callback) => {
  if (typeof callback !== 'function') {
    callback = () => {}
  }
  if (typeof method !== 'string' || method === '') {
    return callback(new Error('No method string provided.'))
  }
  if (typeof args !== 'object' || args === null) {
    return callback(new Error('No arguments object provided.'))
  }

  args.token = getKey('slack')
  args = querystring.stringify(args)

  const req = https.request({
    hostname: 'balticburners.slack.com',
    method: 'POST',
    path: '/api/' + method + '?t=' + (new Date()).getTime(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(args)
    }
  }, res => {
    res.setEncoding('utf8')
    let data = ''
    res.on('data', chunk => { data += chunk })
    res.on('end', () => {
      try {
        data = JSON.parse(data)
      } catch (err) {
        callback(err)
        return
      }

      if (!data.ok) {
        let err = new Error('Slack API invocation error: ' + data.error)
        err.code = data.error
        callback(err, data)
        return
      }

      callback(null, data)
    })
  })

  req.on('error', err => {
    callback(err)
  })

  req.write(args)
  req.end()
}

const emailApply = (visaPeriod, priority, callback) => {
  if (typeof visaPeriod !== 'number') {
    visaPeriod = parseInt(visaPeriod, 10)
  }
  if (typeof visaPeriod !== 'number' || isNaN(visaPeriod)) {
    throw new Error('Visa period for emailApply() is not a valid number.')
  }

  let now = new Date()
  let visasBeingSentOut = visaPeriod <= now.getFullYear()

  db.lrange('queue:' + visaPeriod + ':' + priority, 0, 0, (err, range) => {
    if (err) {
      callback(err)
      return
    }

    const email = range[0]
    if (typeof email !== 'string' || email === '') {
      callback(null)
      return
    }

    db.hgetall('user:' + email, (err, user) => {
      if (err) {
        callback(err)
        return
      }

      let visaId = user['visaid:' + visaPeriod]

      db.hgetall('visa:' + visaPeriod + ':' + email, (err, application) => {
        if (err) {
          callback(err)
          return
        }

        const handle = () => {
          let aemail = typeof application.email === 'string' ? JSON.parse(application.email) : application.email
          if (typeof aemail !== 'string' || aemail === '') {
            aemail = email
          }

          if (visasBeingSentOut) {
            // Visas are being sent out. Ship it.
            console.log('Sending out an entry e-mail to (' + priority + ') ' + email + ' via ' + aemail + '.')

            const send = (pdfBuffer) => {
              let aemail = typeof application.email === 'string' ? JSON.parse(application.email) : application.email
              if (typeof aemail !== 'string' || aemail === '') {
                aemail = email
              }

              const name = (typeof application['name-surname'] === 'string'
                ? JSON.parse(application['name-surname']) : application['name-surname']).trim().toUpperCase()

              let internaltext = 'A new Visa (#' + visaId + ') for DeJā ' + visaPeriod + ' has been issued to ' + name + '.'
              const fae = {}
              visaApplication.forEach(section => {
                fae[section.title] = {}
                internaltext += '\n\n# ' + section.title
                section.questions.forEach(question => {
                  let answer = ''
                  try {
                    if (application[question.id]) {
                      answer = JSON.parse(application[question.id])
                    }
                  } catch (err) {
                    answer = ''
                  }

                  fae[section.title][question.title] = answer
                  internaltext += '\n' + question.title + ': ' + answer
                })
              })

              app.render('email-entry-internalfinal', { visaId, visaPeriod, name, fae }, (err, html) => {
                mailgun.messages().send({
                  from: 'Degošie Jāņi <game@sparklatvia.lv>',
                  to: 'Degošie Jāņi <degosiejani@gmail.com>',
                  bcc: 'Valters Jansons <valter.jansons@gmail.com>',
                  subject: 'New Visa for DeJā ' + visaPeriod,
                  text: internaltext,
                  html: err ? undefined : html,
                  attachment: []
                }, err => {
                  if (err) {
                    callback(err)
                    return
                  }

                  app.render('email-entry-final', { visaPeriod }, (err, html) => {
                    mailgun.messages().send({
                      from: 'Degošie Jāņi <game@sparklatvia.lv>',
                      to: aemail,
                      subject: 'Your entry status for DeJā ' + visaPeriod,
                      text: 'Congratulations! Enclosed is your entry for DeJā' + (typeof visaPeriod === 'string' ? ' ' + visaPeriod : '') + '.' + '\n\n' +
                        'You will need to show a digital copy or a printout of it when you arrive at the gate.' + '\n\n' +
                        'There are 3 attachments in this email. Read them all. Information about donations, meal plan and Slack are enclosed as well as the directions to the property. Please do not share these.' + '\n\n' +
                        'Slack will be inviting you to join the Baltic Burners team. Use it to communicate, to organize and to plan. See you soon!',
                      html: err ? undefined : html,
                      attachment: [
                        new mailgun.Attachment({
                          data: path.join(__dirname, 'email', 'details.pdf'),
                          filename: 'details.pdf',
                          contentType: 'application/pdf'
                        }),
                        new mailgun.Attachment({
                          data: path.join(__dirname, 'email', 'directions.pdf'),
                          filename: 'directions.pdf',
                          contentType: 'application/pdf'
                        }),
                        new mailgun.Attachment({
                          data: pdfBuffer,
                          filename: 'entry.pdf',
                          contentType: 'application/pdf'
                        })
                      ]
                    }, err => {
                      if (err) {
                        callback(err)
                        return
                      }

                      let name = typeof application['name-surname'] === 'string' ? JSON.parse(application['name-surname']) : application['name-surname']
                      name = typeof name === 'string' ? name.split(' ') : ''
                      let surname = name.pop()
                      name = name.join(' ')

                      let channels = [ 'general', 'random' ]
                      let ministries = typeof application['ministry-choice'] === 'string' ? JSON.parse(application['ministry-choice']) : application['ministry-choice']
                      if (Array.isArray(ministries)) {
                        Object.keys(ministrySlackChannels).forEach(match => {
                          ministries.forEach(ministry => {
                            if (ministry.toLowerCase().indexOf(match.toLowerCase()) !== -1) {
                              channels = channels.concat(Array.isArray(ministrySlackChannels[match]) ? ministrySlackChannels[match] : [ ministrySlackChannels[match] ])
                            }
                          })
                        })
                        channels = channels.filter(channel => typeof channel === 'string').sort().filter((channel, index, array) => {
                          return index === 0 || channel !== array[index - 1]
                        })
                      }

                      slack('channels.list', {
                        exclude_archived: true,
                        exclude_members: true
                      }, (err, data) => {
                        if (err) {
                          console.error(err.stack)
                          channels = null
                        } else {
                          if (Array.isArray(channels)) {
                            channels = channels
                              .map(name => data.channels.filter(channel => channel.name === name)[0])
                              .filter(metadata => typeof metadata === 'object' && metadata !== null)
                              .map(metadata => metadata.id)
                          }
                        }

                        slack('users.admin.invite', {
                          email: aemail,
                          channels: Array.isArray(channels) ? channels.join(',') : undefined,
                          first_name: name,
                          last_name: surname,
                          resend: true
                        }, err => {
                          const pushrem = () => {
                            db.rpush('invited:' + visaPeriod + ':' + priority, email, err => {
                              if (err) {
                                callback(err)
                                return
                              }

                              db.lrem('queue:' + visaPeriod + ':' + priority, 0, email, err => {
                                if (err) {
                                  callback(err)
                                  return
                                }

                                callback(null)
                              })
                            })
                          }

                          if (err) {
                            if (err.code === 'already_in_team') {
                              slack('users.list', {
                                presence: false
                              }, (err, data) => {
                                let users = []
                                if (err) {
                                  console.error(err.stack)
                                } else {
                                  if (Array.isArray(data.members)) {
                                    users = data.members
                                      .filter(member => (member.profile || {}).email === aemail)
                                      .map(member => member.id)
                                  }
                                }

                                if (users.length === 0) {
                                  console.error('No such Slack user with e-mail ' + aemail + ' found.')
                                  pushrem()
                                } else {
                                  let user = users[0]
                                  async.each(Array.isArray(channels) ? channels : [], (channel, callback) => {
                                    slack('channels.invite', {
                                      channel,
                                      user
                                    }, err => {
                                      if (err && err.code !== 'already_in_channel') {
                                        console.error(err.stack)
                                      }
                                      callback(null)
                                    })
                                  }, err => {
                                    if (err) {
                                      console.error(err.stack)
                                    }
                                    pushrem()
                                  })
                                }
                              })
                            } else {
                              console.error(err.stack)
                              pushrem()
                            }
                          } else {
                            pushrem()
                          }
                        })
                      })
                    })
                  })
                })
              })
            }

            const image = () => {
              // const PDFDocument = require('pdfkit') ; PDFDocument.prototype.svg = function (svg, x, y, options) { require('svg-to-pdfkit')(this, svg, x, y, options); return this }
              // let __dirname = '.' ; let name = 'VALTERS JANSONS' ; let visaId = 1023
              let name = (typeof application['name-surname'] === 'string' ? JSON.parse(application['name-surname']) : application['name-surname']).trim().toUpperCase()

              let doc = new PDFDocument({ autoFirstPage: false })
              // doc.pipe(new fs.FileWriteStream('output.pdf'))

              var buffers = []
              doc.on('data', data => { buffers.push(data) })
              doc.on('end', () => {
                let pdfBuffer = Buffer.concat(buffers)

                if (user['visaid:' + visaPeriod] !== visaId) {
                  db.hset('user:' + email, 'visaid:' + visaPeriod, visaId, err => {
                    if (err) {
                      callback(err)
                      return
                    }

                    user['visaid:' + visaPeriod] = visaId
                    send(pdfBuffer)
                  })
                } else {
                  send(pdfBuffer)
                }
              })

              doc.info.Author = 'Degošie Jāņi'
              doc.info.Subject = 'Entry Visa Approved'
              doc.info.Title = 'Entry Visa Approved'

              let fontCallback = (family, bold, italic, fontOptions) => {
                let arial = /(?:^|[, ])['"](Arial(?:-(?:Bold)?(?:Italic)?)?MT)['"](?:$|[, ])/.exec(family)
                if (arial) return path.join(__dirname, 'email', arial[1] + '.ttf')
                let antonio = /(?:^|[, ])['"](Antonio-(?:Bold|Light|Regular))['"](?:$|[, ])/.exec(family)
                if (antonio) return path.join(__dirname, 'email', antonio[1] + '.ttf')
                return path.join(__dirname, 'email', 'ArialMT.ttf')
              }

              doc.addPage({ size: [ 841.9, 429.7 ], margin: 0 })
              doc.svg(fs.readFileSync(path.join(__dirname, 'email', 'entry_front.svg'), { encoding: 'utf8' }), 0, 0, { fontCallback })
                .font(path.join(__dirname, 'email', 'Antonio-Bold.ttf'))
                .fontSize(24).fillColor('white').text(name, 630, 165, { width: 160, align: 'center' })
                .fontSize(12).fillColor('white').text('#' + visaId, 10, 10, { width: 160, align: 'left' })

              doc.addPage({ size: [ 841.9, 429.7 ], margin: 0 })
              doc.svg(fs.readFileSync(path.join(__dirname, 'email', 'entry_back.svg'), { encoding: 'utf8' }), 0, 0, { fontCallback })

              doc.end()
            }

            image()
          } else {
            // Visas are not being sent out yet.
            // Resend an email requiring user confirmation about attendance later down the line.
            console.log('Sending out an informational confirmation e-mail to (' + priority + ') ' + email + ' via ' + aemail + '.')

            app.render('email-entry-seeyou', { visaPeriod }, (err, html) => {
              mailgun.messages().send({
                from: 'Degošie Jāņi <game@sparklatvia.lv>',
                to: aemail,
                subject: 'Your entry status for DeJā ' + visaPeriod,
                text: 'Thank you for your submission!' + '\n\n' +
                  'You will be receiving another email with more information. See you next year!',
                html: err ? undefined : html
              }, err => {
                if (err) {
                  callback(err)
                  return
                }

                let sendDate = Date.now()
                let earliestSendDate = +(new Date(visaPeriod, 0, 1)) + Math.floor((10 * 60) + (Math.random() * 30 * 60)) * 1000 // January 1 + 10 to 40 minutes scatter
                if (sendDate < earliestSendDate) {
                  sendDate = earliestSendDate
                }

                db.hset('unconfirmed:' + visaPeriod + ':' + priority, email, sendDate, err => {
                  if (err) {
                    callback(err)
                    return
                  }

                  db.lrem('queue:' + visaPeriod + ':' + priority, 0, email, err => {
                    if (err) {
                      callback(err)
                      return
                    }

                    callback(null)
                  })
                })
              })
            })
          }
        }

        if (typeof visaId === 'undefined') {
          db.incr('visaid:' + visaPeriod, (err, genVisaId) => {
            if (err) {
              callback(err)
              return
            }

            visaId = genVisaId
            handle()
          })
        } else {
          handle()
        }
      })
    })
  })
}

const cleanVeteranApplicationQueueFor = (visaPeriod, rerun) => {
  emailApply(visaPeriod, 'veteran', err => {
    if (err) {
      console.error(err.stack)
      setTimeout(rerun, 60 * 1000)
    } else {
      setTimeout(rerun, 100)
    }
  })
}
const cleanVeteranApplicationQueueForLast = () => { cleanVeteranApplicationQueueFor(getVisaPeriod() - 1, cleanVeteranApplicationQueueForLast) }
setTimeout(cleanVeteranApplicationQueueForLast, 10 * 1000)
const cleanVeteranApplicationQueueForCurrent = () => { cleanVeteranApplicationQueueFor(getVisaPeriod(), cleanVeteranApplicationQueueForCurrent) }
setTimeout(cleanVeteranApplicationQueueForCurrent, 10 * 1000)

const cleanVirginApplicationQueueFor = (visaPeriod, rerun) => {
  db.llen('invited:' + visaPeriod + ':virgin', (err, virginLength) => {
    if (err) {
      console.error(err.stack)
      setTimeout(rerun, 60 * 1000)
      return
    }

    db.hkeys('unconfirmed:' + visaPeriod + ':virgin', (err, unconfirmedVirgins) => {
      if (err) {
        console.error(err.stack)
        setTimeout(rerun, 60 * 1000)
        return
      }

      virginLength += Object.keys(unconfirmedVirgins).length

      db.llen('invited:' + visaPeriod + ':veteran', (err, veteranLength) => {
        if (err) {
          console.error(err.stack)
          setTimeout(rerun, 60 * 1000)
          return
        }

        db.hkeys('unconfirmed:' + visaPeriod + ':veteran', (err, unconfirmedVeterans) => {
          if (err) {
            console.error(err.stack)
            setTimeout(rerun, 60 * 1000)
            return
          }

          veteranLength += Object.keys(unconfirmedVeterans).length

          if (veteranLength < virginLength && '' + visaPeriod !== '2018') {
            setTimeout(rerun, 100)
            return
          }

          emailApply(visaPeriod, 'virgin', err => {
            if (err) {
              console.error(err.stack)
              setTimeout(rerun, 60 * 1000)
            } else {
              setTimeout(rerun, 100)
            }
          })
        })
      })
    })
  })
}
const cleanVirginApplicationQueueForLast = () => { cleanVirginApplicationQueueFor(getVisaPeriod() - 1, cleanVirginApplicationQueueForLast) }
setTimeout(cleanVirginApplicationQueueForLast, 10 * 1000)
const cleanVirginApplicationQueueForCurrent = () => { cleanVirginApplicationQueueFor(getVisaPeriod(), cleanVirginApplicationQueueForCurrent) }
setTimeout(cleanVirginApplicationQueueForCurrent, 10 * 1000)

const cleanUnconfirmedListFor = (visaPeriod, priority, rerun) => {
  db.hgetall('unconfirmed:' + visaPeriod + ':' + priority, (err, unconfirmed) => {
    if (err) {
      console.error(err.stack)
      setTimeout(rerun, 60 * 1000)
      return
    }

    async.eachOf(unconfirmed, (sendDate, email, callback) => {
      // Do not continue if the sending time is in the future or if it is 0.
      // It will be a zero in the period between when the notification has been sent out and the user has actually acknowledged it.
      if (Date.now() < unconfirmed[email] || unconfirmed[email] === '0' || unconfirmed[email] === 0) {
        callback(null)
        return
      }

      db.hgetall('user:' + email, (err, user) => {
        if (err) {
          callback(err)
          return
        }

        db.hgetall('visa:' + visaPeriod + ':' + email, (err, application) => {
          if (err) {
            callback(err)
            return
          }

          let aemail = typeof application.email === 'string' ? JSON.parse(application.email) : application.email
          if (typeof aemail !== 'string' || aemail === '') {
            aemail = email
          }

          console.log('(TODO -- Should be!) Sending out a notification confirmation e-mail to (' + priority + ') ' + email + ' via ' + aemail + '.')
          // TODO Actually send out these confirmations to people. Dante says no worries about getting the text when the time comes.
        })
      })
    }, err => {
      if (err) {
        console.log(err.stack)
      }

      setTimeout(rerun, 60 * 1000)
    })
  })
}
const cleanVirginUnconfirmedListForLast = () => { cleanUnconfirmedListFor(getVisaPeriod() - 1, 'virgin', cleanVirginUnconfirmedListForLast) }
setTimeout(cleanVirginUnconfirmedListForLast, 10 * 1000)
const cleanVirginUnconfirmedListForCurrent = () => { cleanUnconfirmedListFor(getVisaPeriod(), 'virgin', cleanVirginUnconfirmedListForCurrent) }
setTimeout(cleanVirginUnconfirmedListForCurrent, 10 * 1000)
const cleanVeteranUnconfirmedListForLast = () => { cleanUnconfirmedListFor(getVisaPeriod() - 1, 'virgin', cleanVeteranUnconfirmedListForLast) }
setTimeout(cleanVeteranUnconfirmedListForLast, 10 * 1000)
const cleanVeteranUnconfirmedListForCurrent = () => { cleanUnconfirmedListFor(getVisaPeriod(), 'virgin', cleanVeteranUnconfirmedListForCurrent) }
setTimeout(cleanVeteranUnconfirmedListForCurrent, 10 * 1000)
