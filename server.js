#!/usr/bin/env node
'use strict';

/**
 * Randomize array element order in-place.
 * Using Durstenfeld shuffle algorithm.
 * Sourced from http://stackoverflow.com/a/12646864.
 */
const shuffle = (array) => {
  if (!Array.isArray(array)) {
    return null;
  }

  for (var i = array.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var temp = array[i];
    array[i] = array[j];
    array[j] = temp;
  }

  return array;
};

const getVisaPeriod = () => {
  const now = new Date();
  const applicationEnd = new Date(now.getFullYear(), 5, 2);
  return '' + (now.getFullYear() + ((+applicationEnd) > (+now) ? 0 : 1));
};

const async = require('async');
const bcrypt = require('bcryptjs');
const env = require('get-env')();
const express = require('express');
const frontMatter = require('front-matter');
const fs = require('fs');
const https = require('https');
const i18n = require('i18n');
const less = require('less');
const lessCleanCss = new (require('less-plugin-clean-css'))({ s1: true, advanced: true });
const mailgun = require('mailgun-js')({ apiKey: 'key-f092a5bb72bd024a03f67de1144de8a8', domain: 'mg.sparklatvia.lv' });
const path = require('path');
const randomstring = require('randomstring');
const redis = require(env === 'dev' ? 'fakeredis' : 'redis');
const showdown = new (require('showdown').Converter)();
const xlsx = require('xlsx');

const db = redis.createClient();
db.on('error', err => {
  console.error(err.stack);
});

if (env === 'dev') {
  const email = 'a.c@d.c';
  const name = 'Alternating Current';
  const password = randomstring.generate({ length: 8, readable: true, charset: 'alphanumeric' });

  bcrypt.hash(password, 10, (err, hash) => {
    if (err) {
      throw err;
    }

    db.hmset('user:' + email, { password: hash, name: name }, err => {
      if (err) {
        throw err;
      }

      console.log('The development account for "' + name + ' <' + email + '>" has been created.\n    Password: ' + password);
    });
  });
}

const app = express();
app.set('case sensitive routing', true);
app.set('env', env === 'dev' ? 'development' : 'production');
app.set('etag', 'strong');
app.set('port', process.env.PORT || 8080);
app.set('strict routing', true);
app.set('trust proxy', false);
app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'));
app.set('x-powered-by', false);

app.use(require('morgan')('dev'));
app.use(require('helmet')());
app.use(require('body-parser').json());
app.use(require('body-parser').urlencoded({ extended: true }));
app.use(require('cookie-parser')());
i18n.configure({
  locales: fs.readdirSync(path.join(__dirname, 'locales')).map(locale => path.basename(locale, '.json')),
  defaultLocale: 'en',
  cookie: 'lang',
  directory: path.join(__dirname, 'locales'),
  updateFiles: env === 'dev',
  syncFiles: env === 'dev'
});
app.use(i18n.init);
showdown.setFlavor('github');
showdown.setOption('omitExtraWLInCodeBlocks', true);
showdown.setOption('parseImgDimensions', true);
showdown.setOption('simplifiedAutoLink', true);
showdown.setOption('excludeTrailingPunctuationFromURLs', true);
showdown.setOption('literalMidWordUnderscores', true);
showdown.setOption('smoothLivePreview', true);
showdown.setOption('smartIndentationFix', true);
showdown.setOption('simpleLineBreaks', true);

const returnBadAction = (req, res) => {
  res.status(405);
  res.type('application/json; charset=utf-8');
  res.send('{}');
};

app.use((req, res, next) => {
  res.set('Cache-Control', 'private, max-age=60');
  next();
});

if (env === 'dev') {
  app.get('/favicon.png', (req, res) => {
    const target = '/favicon.dev.png';
    res.render('redirect', { target: target }, (err, html) => {
      res.status(307);
      res.location(target);
      if (err) {
        res.type('text/plain; charset=utf-8');
        res.send(target);
        console.error(err.stack);
      } else {
        res.type('text/html; charset=utf-8');
        res.send(html);
      }
    });
  });
  app.all('/favicon.png', returnBadAction);
}

app.use(express.static(path.join(__dirname, 'static')));
app.use(express.static(path.join(__dirname, 'bower_components')));

app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.use((req, res, next) => {
  res.locals.acl = (acl) => {
    if (typeof acl === 'undefined' || acl === null) {
      return true;
    }

    if (Array.isArray(acl)) {
      return acl.reduce((prev, next) => prev && res.locals.acl(next), true);
    }

    if (!res.locals.user) {
      return false;
    }

    if (typeof acl === 'string') {
      acl = acl.split('{visaPeriod}').join(getVisaPeriod());

      return !!res.locals.user[acl];
    }

    return false;
  };

  const token = req.cookies.token;

  if (typeof token !== 'string' || token === '') {
    next();
    return;
  }

  db.get('session:' + token, (err, reply) => {
    if (err) {
      next();
      return;
    }

    if (typeof reply !== 'string' || reply === '') {
      next();
      return;
    }

    db.hgetall('user:' + reply, (err, user) => {
      if (err || !user) {
        next();
        return;
      }

      res.locals.user = Object.assign(user, {
        email: reply
      });
      next();
    });
  });
});

app.get('/', (req, res) => {
  const localeHash = {};
  i18n.getLocales().forEach(locale => {
    localeHash[locale] = '/' + locale + '/';
  });

  res.render('index', { altLocales: localeHash, subpages: sitemap.slice(0) });
});
app.all('/', returnBadAction);

i18n.getLocales().forEach(locale => {
  app.get('/' + locale, (req, res) => {
    req.setLocale(locale);

    const target = '/' + locale + '/';
    res.render('redirect', { target: target }, (err, html) => {
      res.status(307);
      res.location(target);
      if (err) {
        res.type('text/plain; charset=utf-8');
        res.send(target);
        console.error(err.stack);
      } else {
        res.type('text/html; charset=utf-8');
        res.send(html);
      }
    });
  });
  app.all('/' + locale, returnBadAction);

  app.get('/' + locale + '/', (req, res) => {
    req.setLocale(locale);

    const localeHash = {};
    i18n.getLocales().forEach(locale => {
      localeHash[locale] = '/' + locale + '/';
    });

    res.render('index', { altLocales: localeHash, subpages: sitemap.slice(0) });
  });
  app.all('/' + locale + '/', returnBadAction);
});

app.post('/user/update', (req, res) => {
  if (!res.locals.user) {
    res.status(403);
    res.type('application/json; charset=utf-8');
    res.send('{}');
  }

  const email = res.locals.user.email;

  if (typeof req.body.name === 'string' && req.body.name !== '') {
    db.hset('user:' + email, 'name', req.body.name, err => {
      if (err) {
        throw err;
      }

      res.status(200);
      res.type('application/json; charset=utf-8');
      res.send('{}');
    });
  } else {
    res.status(400);
    res.type('application/json; charset=utf-8');
    res.send('{}');
  }
});
app.all('/user/update', returnBadAction);

app.get('/admin/visa-application/:year', (req, res, next) => {
  if (!res.locals.user || !res.locals.user.admin) {
    next();
    return;
  }

  const year = '' + req.params.year;
  if (isNaN(parseInt(year, 10))) {
    res.status(400);
    res.type('text/plain; charset=utf-8');
    res.send('Year provided must be a number.');
    return;
  }

  db.keys('visa:' + year + ':*', (err, reply) => {
    if (err) {
      res.status(500);
      res.type('text/plain; charset=utf-8');
      res.send('Something broke horribly. Sorry.');
      console.error(err.stack);
      return;
    }

    async.map(reply.sort(), (key, callback) => {
      db.hgetall(key, (err, reply) => {
        if (err) {
          callback(err);
          return;
        }

        let obj = {};
        Object.keys(reply).forEach(key => {
          try {
            if (obj) {
              obj[key] = JSON.parse(reply[key]);
            }
          } catch (err) {
            obj = null;
            callback(err);
            return;
          }
        });
        if (!obj) {
          return;
        }

        callback(null, obj);
      });
    }, (err, reply) => {
      if (err) {
        res.status(500);
        res.type('text/plain; charset=utf-8');
        res.send('Something broke horribly. Sorry.');
        console.error(err.stack);
        return;
      }

      const worksheet = { '!cols': [] };
      const workbook = { SheetNames: [ 'Visa Applications' ], Sheets: { 'Visa Applications': worksheet } };
      const range = { s: { c: 10000000, r: 10000000 }, e: { c: 0, r: 0 } };

      const header = visaApplication.reduce((prev, next) => prev.concat(next.questions), []);
      const data = [ header.map(question => question.title) ].concat(reply.map(application => header.slice(0).map(question => application[question.id] || null)));

      for (let r = 0; r < data.length; ++r) {
        for (let c = 0; c < data[r].length; ++c) {
          if (range.s.r > r) { range.s.r = r; }
          if (range.s.c > c) { range.s.c = c; }
          if (range.e.r < r) { range.e.r = r; }
          if (range.e.c < c) { range.e.c = c; }

          let cell = { v: data[r][c] };
          if (r === 0) {
            worksheet['!cols'][c] = { wch: typeof cell.v === 'string' ? cell.v.length : 15 };
          }
          if (cell.v !== null) {
            if (typeof cell.v === 'number') {
              cell.t = 'n';
            } else if (typeof cell.v === 'boolean') {
              cell.t = 'b';
            } else if (!isNaN(parseInt(cell.v, 10))) {
              cell.v = parseInt(cell.v, 10);
              cell.t = 'n';
            } else if (cell.v === 'true' || cell.v === 'false') {
              cell.v = cell.v === 'true';
              cell.t = 'b';
            } else {
              cell.t = 's';
            }

            worksheet[xlsx.utils.encode_cell({ c, r })] = cell;
          }
        }
      }

      worksheet['!ref'] = xlsx.utils.encode_range(range);

      res.status(200);
      res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=visa-application.' + year + '.xlsx');
      res.send(new Buffer(xlsx.write(workbook, { bookType: 'xlsx', bookSST: false, type: 'base64' }), 'base64'));
    });
  });
});
app.all('/admin/visa-application/:year', returnBadAction);

(() => {
  const title = 'Log In';

  const catchLogin = locale => {
    app.get(encodeURI(localeHash[locale]), (req, res) => {
      req.setLocale(locale);
      const location = (req.body ? req.body.location : '') || (req.headers ? req.headers.referer : '') || ('/' + locale + '/');

      res.render('log-in', { altLocales: localeHash, title: req.__(title), markdown: '', hideNavigation: true, location: location }, (err, html) => {
        if (err) {
          res.status(500);
          res.type('text/plain; charset=utf-8');
          res.send('Something broke horribly. Sorry.');
          console.error(err.stack);
        } else {
          res.status(200);
          res.type('text/html; charset=utf-8');
          res.send(html);
        }
      });
    });
    app.post(encodeURI(localeHash[locale]), (req, res) => {
      req.setLocale(locale);
      const email = req.body ? req.body.email : '';
      const password = req.body ? req.body.password : '';
      const location = (req.body ? req.body.location : '') || ('/' + locale + '/');

      const rerender = err => {
        res.render('log-in', { altLocales: localeHash, title: req.__(title), markdown: '', hideNavigation: true, location: location, err: err, email: email }, (err, html) => {
          if (err) {
            res.status(500);
            res.type('text/plain; charset=utf-8');
            res.send('Something broke horribly. Sorry.');
            console.error(err.stack);
          } else {
            res.status(200);
            res.type('text/html; charset=utf-8');
            res.send(html);
          }
        });
      };

      if (typeof email !== 'string' || email === '' || typeof password !== 'string' || password === '') {
        rerender(new Error('No e-mail and password combination provided.'));
        return;
      }

      db.hget('user:' + email, 'password', (err, reply) => {
        if (err) {
          console.error(err.stack);
        }

        if (typeof reply !== 'string' || reply === '') {
          // We still want to run bcrypt to avoid timing attacks.
          reply = '';
        }

        bcrypt.compare(password, reply, (err, match) => {
          if (err) {
            rerender(new Error('Internal validation error encountered.'));
            console.error(err.stack);
            return;
          }

          if (!match) {
            rerender(new Error('Incorrect e-mail and password combination provided.'));
            return;
          }

          const token = randomstring.generate({ length: 32, charset: 'alphanumeric' });
          const tokenExpirySeconds = 60/* s */ * 60/* m */ * 3/* h */;
          db.setex('session:' + token, tokenExpirySeconds, email, err => {
            if (err) {
              rerender(new Error('Internal database error encountered.'));
              console.error(err.stack);
              return;
            }

            res.cookie('token', token, { path: '/', maxAge: 1000 * tokenExpirySeconds, httpOnly: true, secure: true });

            res.render('redirect', { target: location }, (err, html) => {
              res.status(303);
              res.location(location);
              if (err) {
                res.type('text/plain; charset=utf-8');
                res.send(location);
                console.error(err.stack);
              } else {
                res.type('text/html; charset=utf-8');
                res.send(html);
              }
            });
          });
        });
      });
    });
    app.all(encodeURI(localeHash[locale]), returnBadAction);
  };

  const navbarHash = {};
  const localeHash = {};

  i18n.__h(title).forEach(subhash => {
    for (var locale in subhash) {
      if (!subhash.hasOwnProperty(locale)) { continue; }
      navbarHash[locale] = subhash[locale];
      localeHash[locale] = '/' + locale + '/' + navbarHash[locale].toLowerCase().split(' ').join('-').split('/').join('-');
    }
  });

  for (var locale in navbarHash) {
    if (!navbarHash.hasOwnProperty(locale)) { continue; }
    catchLogin(locale);
  }
})();

(() => {
  const title = 'Log Out';

  const catchLogout = locale => {
    app.get(encodeURI(localeHash[locale]), (req, res) => {
      req.setLocale(locale);
      const location = (req.body ? req.body.location : '') || (req.headers ? req.headers.referer : '') || ('/' + locale + '/');
      res.cookie('token', '', { path: '/', maxAge: 1, httpOnly: true, secure: true });
      res.render('redirect', { target: location }, (err, html) => {
        res.status(303);
        res.location(location);
        if (err) {
          res.type('text/plain; charset=utf-8');
          res.send(location);
          console.error(err.stack);
        } else {
          res.type('text/html; charset=utf-8');
          res.send(html);
        }
      });
    });
    app.all(encodeURI(localeHash[locale]), returnBadAction);
  };

  const navbarHash = {};
  const localeHash = {};

  i18n.__h(title).forEach(subhash => {
    for (var locale in subhash) {
      if (!subhash.hasOwnProperty(locale)) { continue; }
      navbarHash[locale] = subhash[locale];
      localeHash[locale] = '/' + locale + '/' + navbarHash[locale].toLowerCase().split(' ').join('-').split('/').join('-');
    }
  });

  for (var locale in navbarHash) {
    if (!navbarHash.hasOwnProperty(locale)) { continue; }
    catchLogout(locale);
  }
})();

(() => {
  const title = 'Register';

  const catchRegister = locale => {
    app.get(encodeURI(localeHash[locale]), (req, res) => {
      req.setLocale(locale);

      res.render('register', { altLocales: localeHash, title: req.__(title), markdown: '', hideNavigation: true }, (err, html) => {
        if (err) {
          res.status(500);
          res.type('text/plain; charset=utf-8');
          res.send('Something broke horribly. Sorry.');
          console.error(err.stack);
        } else {
          res.status(200);
          res.type('text/html; charset=utf-8');
          res.send(html);
        }
      });
    });
    app.post(encodeURI(localeHash[locale]), (req, res) => {
      req.setLocale(locale);
      const name = req.body ? req.body.name : '';
      const email = req.body ? req.body.email : '';
      const location = '/' + locale + '/' + req.__('Log In').toLowerCase().split(' ').join('-').split('/').join('-');

      const rerender = err => {
        res.render('register', { altLocales: localeHash, title: req.__(title), markdown: '', hideNavigation: true, location: location, err: err, name: name, email: email }, (err, html) => {
          if (err) {
            res.status(500);
            res.type('text/plain; charset=utf-8');
            res.send('Something broke horribly. Sorry.');
            console.error(err.stack);
          } else {
            res.status(200);
            res.type('text/html; charset=utf-8');
            res.send(html);
          }
        });
      };

      if (typeof name !== 'string' || name === '' || typeof email !== 'string' || email === '') {
        rerender(new Error('No e-mail and password combination provided.'));
        return;
      }

      const password = randomstring.generate({ length: 8, readable: true, charset: 'alphanumeric' });

      bcrypt.hash(password, 10, (err, hash) => {
        if (err) {
          rerender(new Error('Internal validation error encountered.'));
          console.error(err.stack);
          return;
        }

        // We still want to run bcrypt to avoid timing attacks.
        db.hexists('user:' + email, 'password', (err, reply) => {
          if (err) {
            rerender(new Error('Internal database error encountered.'));
            console.error(err.stack);
            return;
          }

          if (reply) {
            res.render('redirect', { target: location }, (err, html) => {
              res.status(303);
              res.location(location);
              if (err) {
                res.type('text/plain; charset=utf-8');
                res.send(location);
                console.error(err.stack);
              } else {
                res.type('text/html; charset=utf-8');
                res.send(html);
              }
            });
            return;
          }

          db.hmset('user:' + email, { password: hash, name: name }, err => {
            if (err) {
              rerender(new Error('Internal database error encountered.'));
              console.error(err.stack);
              return;
            }

            app.render('email', { password: password }, (err, html) => {
              mailgun.messages().send({
                from: 'Degošie Jāņi <game@sparklatvia.lv>',
                to: email,
                subject: 'Your registration with DeJā',
                text: req.__('Welcome!') + '\n\n' +
                  req.__mf('Your password is {password}.', { password: password }) + '\n\n' +
                  req.__('If you did not register for anything, just ignore this message.'),
                html: err ? undefined : html
              }, err => {
                if (err) {
                  rerender(new Error('Internal dispatching error encountered.'));
                  console.error(err.stack);
                  return;
                }

                res.render('redirect', { target: location }, (err, html) => {
                  res.status(303);
                  res.location(location);
                  if (err) {
                    res.type('text/plain; charset=utf-8');
                    res.send(location);
                    console.error(err.stack);
                  } else {
                    res.type('text/html; charset=utf-8');
                    res.send(html);
                  }
                });
              });
            });
          });
        });
      });
    });
    app.all(encodeURI(localeHash[locale]), returnBadAction);
  };

  const navbarHash = {};
  const localeHash = {};

  i18n.__h(title).forEach(subhash => {
    for (var locale in subhash) {
      if (!subhash.hasOwnProperty(locale)) { continue; }
      navbarHash[locale] = subhash[locale];
      localeHash[locale] = '/' + locale + '/' + navbarHash[locale].toLowerCase().split(' ').join('-').split('/').join('-');
    }
  });

  for (var locale in navbarHash) {
    if (!navbarHash.hasOwnProperty(locale)) { continue; }
    catchRegister(locale);
  }
})();

const sitemap = JSON.parse(fs.readFileSync(path.join(__dirname, 'sitemap.json'), { encoding: 'utf8' }));
const questions = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), { encoding: 'utf8' }));
const visaApplication = JSON.parse(fs.readFileSync(path.join(__dirname, 'visa-application.json'), { encoding: 'utf8' }));

function catchAllFor (backstack, sitemap) {
  if (!Array.isArray(sitemap)) { sitemap = []; }
  sitemap.forEach(page => {
    if (typeof page.title !== 'string') { throw new Error('Page title not provided as a string.'); }
    if (!Array.isArray(page.subpages)) { page.subpages = []; }
    if (typeof page.render !== 'object' || page.render === null) { page.render = {}; }

    const stack = JSON.parse(JSON.stringify(backstack));
    stack[stack.length] = { title: {}, href: {}, render: page.render };

    const reduceToHref = locale => {
      return stack.reduce((prev, next) => prev + '/' + next.title[locale].toLowerCase().split(' ').join('-').split('/').join('-'), '/' + locale);
    };

    i18n.__h(page.title).forEach(subhash => {
      for (var locale in subhash) {
        if (!subhash.hasOwnProperty(locale)) { continue; }
        stack[stack.length - 1].title[locale] = subhash[locale];
        stack[stack.length - 1].href[locale] = reduceToHref(locale);
      }
    });

    page.questions = {};
    if (page.type === 'questions') {
      page.questions = questions;
      stack.forEach(item => {
        if (typeof page.questions !== 'object' || page.questions === null) { page.questions = {}; }
        page.questions = page.questions[item.title.en];
      });
      if (typeof page.questions !== 'object' || page.questions === null) { page.questions = {}; }
    } else if (page.type === 'visa-application') {
      page.questions = visaApplication.filter(section => section.title === page.title)[0];
      if (typeof page.questions !== 'object' || page.questions === null) { page.questions = {}; }
    }

    if (!page.hidden) {
      const catchAll = (localeHash, locale, view, title, renderOverrides) => {
        app.get(encodeURI(localeHash[locale]), (req, res) => {
          req.setLocale(locale);
          if (!res.locals.acl(page.acl)) {
            const target = res.locals.user
              ? page.render.previouspage
                ? stack.slice(0, -1).reduce((prev, next) => prev +
                  '/' + next.title[locale].toLowerCase().split(' ').join('-').split('/').join('-'), '/' + locale) +
                    '/' + req.__(page.render.previouspage).toLowerCase().split(' ').join('-').split('/').join('-')
                : '/' + locale + '/'
              : '/' + locale + '/' + req.__('Log In').toLowerCase().split(' ').join('-').split('/').join('-');
            res.render('redirect', { target: target }, (err, html) => {
              res.status(303);
              res.location(target);
              if (err) {
                res.type('text/plain; charset=utf-8');
                res.send(target);
                console.error(err.stack);
              } else {
                res.type('text/html; charset=utf-8');
                res.send(html);
              }
            });
            return;
          }
          const preroute = callback => {
            if (page.type === 'questions') {
              if (!res.locals.user) {
                callback(false);
                return;
              }

              const field = stack.reduce((prev, next) => prev + '.' + next.title.en, 'answer');
              if (res.locals.user[field]) {
                const target = '/' + locale + '/' + page.questions.nextPage
                  .map(part => req.__(part).toLowerCase().split(' ').join('-').split('/').join('-')).join('/');
                res.render('redirect', { target: target }, (err, html) => {
                  res.status(303);
                  res.location(target);
                  if (err) {
                    res.type('text/plain; charset=utf-8');
                    res.send(target);
                    console.error(err.stack);
                  } else {
                    res.type('text/html; charset=utf-8');
                    res.send(html);
                  }
                });
                callback(true);
              } else {
                callback(false);
              }
            } else if (page.type === 'visa-application') {
              if (!res.locals.user) {
                callback(false);
                return;
              }

              const field = stack.reduce((prev, next) => prev + '.' + next.title.en, 'answer');
              if (res.locals.user[field]) {
                const target = (stack.slice(0, -1).reduce((prev, next) => prev +
                  '/' + next.title[locale].toLowerCase().split(' ').join('-').split('/').join('-'), '/' + locale) +
                    '/' + req.__(page.render.nextpage).toLowerCase().split(' ').join('-').split('/').join('-'));
                res.render('redirect', { target: target }, (err, html) => {
                  res.status(303);
                  res.location(target);
                  if (err) {
                    res.type('text/plain; charset=utf-8');
                    res.send(target);
                    console.error(err.stack);
                  } else {
                    res.type('text/html; charset=utf-8');
                    res.send(html);
                  }
                });
                callback(true);
              } else {
                callback(false);
              }
            } else {
              callback(false);
            }
          };
          const prerender = callback => {
            const setViewStatus = () => {
              if (!res.locals.user) {
                callback(null);
                return;
              }

              const field = stack.reduce((prev, next) => prev + '.' + next.title.en, 'view');
              const value = Date.now();
              db.hsetnx('user:' + res.locals.user.email, field, value, err => {
                if (err) {
                  callback(err);
                  return;
                }

                res.locals.user[field] = value;
                callback(null);
              });
            };

            if (page.type === 'questions') {
              if (!res.locals.user) {
                callback(new Error('No user to assign question choices to.'));
                return;
              }

              const field = stack.reduce((prev, next) => prev + '.' + next.title.en, 'questions');
              if (res.locals.user[field]) {
                try {
                  res.locals.questions = JSON.parse(res.locals.user[field]);
                } catch (err) {
                  callback(err);
                  return;
                }
                setViewStatus();
              } else {
                res.locals.questions = shuffle(page.questions.questions.slice(0)).splice(0, 2);
                const value = JSON.stringify(res.locals.questions);
                db.hsetnx('user:' + res.locals.user.email, field, value, (err, reply) => {
                  if (err) {
                    callback(err);
                    return;
                  }

                  if (reply === 1) {
                    res.locals.user[field] = value;
                    setViewStatus();
                  } else if (reply === 0) {
                    db.hget('user:' + res.locals.user.email, field, (err, reply) => {
                      if (err) {
                        callback(err);
                      }

                      if (typeof reply !== 'string' || reply === '') {
                        db.hset('user:' + res.locals.user.email, field, value, err => callback(err));
                        return;
                      }

                      res.locals.user[field] = reply;
                      try {
                        res.locals.questions = JSON.parse(reply);
                      } catch (err) {
                        callback(err);
                        return;
                      }
                      setViewStatus();
                    });
                  } else {
                    callback(new Error('Unexpected return value from HSETNX.'));
                  }
                });
              }
            } else if (page.type === 'visa-application') {
              res.locals.questions = page.questions.questions.slice(0);
              setViewStatus();
            } else {
              setViewStatus();
            }
          };
          const render = markdown => {
            preroute(intercepted => {
              if (intercepted) { return; }

              prerender(err => {
                if (err) {
                  res.status(500);
                  res.type('text/plain; charset=utf-8');
                  res.send('Something broke horribly. Sorry.');
                  console.error(err.stack);
                  return;
                }

                const renderParams = Object.assign({
                  altLocales: localeHash,
                  title: req.__(title),
                  stackpages: stack.map(el => el.title.en),
                  subpages: page.subpages.filter(page => page.type !== 'questions'),
                  siblingpages: sitemap.filter(page => page.type !== 'questions'),
                  markdown: markdown
                }, renderOverrides || {});
                res.render(encodeURIComponent(page.type || view.split('.')[0]), renderParams, (err, html) => {
                  if (err) {
                    res.render('layout', renderParams, (err, html) => {
                      if (err) {
                        res.status(500);
                        res.type('text/plain; charset=utf-8');
                        res.send('Something broke horribly. Sorry.');
                        console.error(err.stack);
                      } else {
                        res.status(200);
                        res.type('text/html; charset=utf-8');
                        res.send(html);
                      }
                    });
                  } else {
                    res.status(200);
                    res.type('text/html; charset=utf-8');
                    res.send(html);
                  }
                });
              });
            });
          };
          fs.readFile(path.join(__dirname, 'pages', encodeURIComponent(view + '.' + locale + '.md')), { encoding: 'utf8' }, (err, data) => {
            if (err) {
              fs.readFile(path.join(__dirname, 'pages', encodeURIComponent(view + '.en.md')), { encoding: 'utf8' }, (err, data) => {
                if (err) {
                  render('');
                } else {
                  render(showdown.makeHtml(frontMatter(data).body.trim()).split('\n').join(''));
                }
              });
            } else {
              render(showdown.makeHtml(frontMatter(data).body.trim()).split('\n').join(''));
            }
          });
        });
        if (page.type === 'questions') {
          app.post(encodeURI(localeHash[locale]), (req, res) => {
            if (!res.locals.user) {
              res.status(400);
              res.type('text/plain; charset=utf-8');
              res.send('WHO_ARE_YOU');
              return;
            }

            const field = stack.reduce((prev, next) => prev + '.' + next.title.en, 'questions');
            if (!res.locals.user[field]) {
              const target = '/' + locale + '/' + req.__('Log In').toLowerCase().split(' ').join('-').split('/').join('-');
              res.render('redirect', { target: target }, (err, html) => {
                res.status(303);
                res.location(target);
                if (err) {
                  res.type('text/plain; charset=utf-8');
                  res.send(target);
                  console.error(err.stack);
                } else {
                  res.type('text/html; charset=utf-8');
                  res.send(html);
                }
              });
              return;
            }

            try {
              res.locals.questions = JSON.parse(res.locals.user[field]);
            } catch (err) {
              res.status(500);
              res.type('text/plain; charset=utf-8');
              res.send('Something broke horribly. Sorry.');
              console.error(err.stack);
              return;
            }

            const rerender = () => {
              const target = req.url;
              res.render('redirect', { target: target }, (err, html) => {
                res.status(303);
                res.location(target);
                if (err) {
                  res.type('text/plain; charset=utf-8');
                  res.send(target);
                  console.error(err.stack);
                } else {
                  res.type('text/html; charset=utf-8');
                  res.send(html);
                }
              });
            };

            for (let i = 0; i < res.locals.questions.length; i++) {
              if (res.locals.questions[i].question !== req.body['q' + i]) {
                res.status(400);
                res.type('text/plain; charset=utf-8');
                res.send('WHAT_IN_QUESTION');
                return;
              }

              let expectedAnswer = res.locals.questions[i].expectedAnswer;
              if (expectedAnswer === null) { expectedAnswer = res.locals.questions[i].answers; }
              let actualAnswer = req.body['a' + i];

              if (Array.isArray(expectedAnswer)) {
                if (!Array.isArray(actualAnswer) || actualAnswer.length === 0) {
                  rerender();
                  return;
                }

                for (let j = 0; j < actualAnswer.length; j++) {
                  if (expectedAnswer.indexOf(actualAnswer[j]) === -1) {
                    rerender();
                    return;
                  }
                }
              } else if (actualAnswer !== expectedAnswer) {
                rerender();
                return;
              }
            }

            const fieldAns = stack.reduce((prev, next) => prev + '.' + next.title.en, 'answer');
            const valueAns = Date.now();
            db.hsetnx('user:' + res.locals.user.email, fieldAns, valueAns, err => {
              if (err) {
                res.status(500);
                res.type('text/plain; charset=utf-8');
                res.send('Something broke horribly. Sorry.');
                console.error(err.stack);
                return;
              }

              res.locals.user[fieldAns] = valueAns;

              const target = '/' + locale + '/' + page.questions.nextPage
                .map(part => req.__(part).toLowerCase().split(' ').join('-').split('/').join('-')).join('/');
              res.render('redirect', { target: target }, (err, html) => {
                res.status(303);
                res.location(target);
                if (err) {
                  res.type('text/plain; charset=utf-8');
                  res.send(target);
                  console.error(err.stack);
                } else {
                  res.type('text/html; charset=utf-8');
                  res.send(html);
                }
              });
            });
          });
        } else if (page.type === 'visa-application') {
          app.post(encodeURI(localeHash[locale]), (req, res) => {
            if (!res.locals.user) {
              res.status(400);
              res.type('text/plain; charset=utf-8');
              res.send('WHO_ARE_YOU');
              return;
            }

            const h = {};

            res.locals.questions = page.questions.questions.slice(0);
            for (let i = 0; i < res.locals.questions.length; i++) {
              let id = res.locals.questions[i].id;
              let ans = typeof req.body[id] === 'string' || Array.isArray(req.body[id]) ? req.body[id] : '';

              switch (res.locals.questions[i].type) {
                case 'text':
                case 'email':
                case 'date':
                case 'country':
                  if (typeof ans !== 'string') {
                    res.status(400);
                    res.type('text/plain; charset=utf-8');
                    res.send('WHAT_IN_QUESTION');
                    return;
                  }
                  h[id] = JSON.stringify(ans);
                  break;
                case 'single':
                  if (typeof ans !== 'string' || res.locals.questions[i].answers.indexOf(ans) === -1) {
                    res.status(400);
                    res.type('text/plain; charset=utf-8');
                    res.send('WHAT_IN_QUESTION');
                    return;
                  }
                  h[id] = JSON.stringify(ans);
                  break;
                case 'multiple':
                  if (!Array.isArray(ans)) {
                    res.status(400);
                    res.type('text/plain; charset=utf-8');
                    res.send('WHAT_IN_QUESTION');
                    return;
                  }
                  for (var j = 0; j < ans.length; j++) {
                    if (res.locals.questions[i].answers.indexOf(ans[j]) === -1) {
                      res.status(400);
                      res.type('text/plain; charset=utf-8');
                      res.send('WHAT_IN_QUESTION');
                      return;
                    }
                  }
                  h[id] = JSON.stringify(ans);
                  break;
                case 'yes/no':
                case 'yes/no;textifyes':
                case 'yes/no;textifno':
                  if (ans !== 'yes' && ans !== 'no') {
                    res.status(400);
                    res.type('text/plain; charset=utf-8');
                    res.send('WHAT_IN_QUESTION');
                    return;
                  }
                  const textif = res.locals.questions[i].type.split(';')
                    .filter(part => part.startsWith('textif'))
                    .map(part => part.substr('textif'.length))
                    .reduce((prev, next) => prev + next, '');
                  if (ans === textif) {
                    let exp = typeof req.body[id + '.explanation'] === 'string' ? req.body[id + '.explanation'] : '';
                    if (typeof exp !== 'string' || exp === '') {
                      res.status(400);
                      res.type('text/plain; charset=utf-8');
                      res.send('WHAT_IN_QUESTION');
                      return;
                    }

                    h[id] = JSON.stringify(ans + ': ' + exp);
                  } else {
                    h[id] = JSON.stringify(ans);
                  }
                  break;
              }
            }

            const moveForward = () => {
              const target = stack.slice(0, -1).reduce((prev, next) => prev +
                '/' + next.title[locale].toLowerCase().split(' ').join('-').split('/').join('-'), '/' + locale) +
                  '/' + req.__(page.render.nextpage).toLowerCase().split(' ').join('-').split('/').join('-');
              res.render('redirect', { target: target }, (err, html) => {
                res.status(303);
                res.location(target);
                if (err) {
                  res.type('text/plain; charset=utf-8');
                  res.send(target);
                  console.error(err.stack);
                } else {
                  res.type('text/html; charset=utf-8');
                  res.send(html);
                }
              });
            };

            const visaPeriod = getVisaPeriod();
            const fieldAns = stack.reduce((prev, next) => prev + '.' + next.title.en, 'answer') + '.' + visaPeriod;
            db.hget('user:' + res.locals.user.email, fieldAns, (err, reply) => {
              if (err) {
                res.status(500);
                res.type('text/plain; charset=utf-8');
                res.send('Something broke horribly. Sorry.');
                console.error(err.stack);
                return;
              }

              if ((typeof reply === 'string' || typeof reply === 'number') && reply !== '' && reply !== 0) {
                moveForward();
                return;
              }

              db.hmset('visa:' + visaPeriod + ':' + res.locals.user.email, h, err => {
                if (err) {
                  res.status(500);
                  res.type('text/plain; charset=utf-8');
                  res.send('Something broke horribly. Sorry.');
                  console.error(err.stack);
                  return;
                }

                const valueAns = Date.now();
                db.hsetnx('user:' + res.locals.user.email, fieldAns, valueAns, err => {
                  if (err) {
                    res.status(500);
                    res.type('text/plain; charset=utf-8');
                    res.send('Something broke horribly. Sorry.');
                    console.error(err.stack);
                    return;
                  }

                  res.locals.user[fieldAns] = valueAns;

                  moveForward();
                });
              });
            });
          });
        }
        app.all(encodeURI(localeHash[locale]), returnBadAction);
      };

      for (var locale in stack[stack.length - 1].title) {
        if (!stack[stack.length - 1].title.hasOwnProperty(locale)) { continue; }
        catchAll(stack[stack.length - 1].href, locale,
          stack.map(el => el.title.en.toLowerCase().split(' ').join('-').split('/').join('-')).join('.'),
          stack[stack.length - 1].title[locale], stack[stack.length - 1].render);
      }
    } else if (typeof page.hidden === 'string') {
      const catchAllRedirect = (hash, locale, target) => {
        app.get(encodeURI(hash), (req, res) => {
          req.setLocale(locale);
          res.render('redirect', { target: target }, (err, html) => {
            res.status(303);
            res.location(target);
            if (err) {
              res.type('text/plain; charset=utf-8');
              res.send(target);
              console.error(err.stack);
            } else {
              res.type('text/html; charset=utf-8');
              res.send(html);
            }
          });
        });
        app.all(encodeURI(hash), returnBadAction);
      };

      for (var localeRedirect in stack[stack.length - 1].title) {
        if (!stack[stack.length - 1].title.hasOwnProperty(localeRedirect)) { continue; }
        catchAllRedirect(stack[stack.length - 1].href[localeRedirect], localeRedirect, stack[stack.length - 1].href[localeRedirect] + '/' +
          i18n.__({ phrase: page.hidden, locale: localeRedirect }).toLowerCase().split(' ').join('-').split('/').join('-'));
      }
    }

    catchAllFor(stack, page.subpages);
  });
}
catchAllFor([], sitemap.slice(0));

var cssCache = null;
const renderLess = callback => {
  fs.readFile(path.join(__dirname, 'less', 'main.less'), { encoding: 'utf8' }, (err, data) => {
    if (err) {
      callback(err, null);
    } else {
      less.render(data, {
        'include-path': [ path.join(__dirname, 'less') ],
        plugins: [ lessCleanCss ]
      }).then(out => {
        callback(null, out.css + '\n');
      }, err => {
        callback(err, null);
      });
    }
  });
};
renderLess((err, css) => {
  if (err) {
    cssCache = null;
  } else {
    cssCache = css;
  }
});
app.get('/main.css', (req, res) => {
  if (env === 'dev') {
    renderLess((err, css) => {
      if (err) {
        res.status(500);
        res.type('text/css; charset=utf-8');
        res.send('/* Error reading file: ' + (err.code || err.type || 'OOPS') + ' */\n');
      } else {
        res.status(200);
        res.type('text/css; charset=utf-8');
        res.send(css);
      }
    });
    return;
  }

  res.status(cssCache ? 200 : 500);
  res.type('text/css; charset=utf-8');
  res.send(cssCache || '/* Failed to read the styles. */\n');
});
app.all('/main.css', returnBadAction);

app.use((req, res) => {
  res.render('404', { title: '404' }, (err, html) => {
    if (err) {
      res.status(500);
      res.type('text/plain; charset=utf-8');
      res.send('Something broke horribly. Sorry.');
      console.error(err.stack);
    } else {
      res.status(404);
      res.type('text/html; charset=utf-8');
      res.send(html);
    }
  });
});

let pfx = null;
try {
  pfx = fs.readFileSync(path.join(__dirname, 'cert.pfx'), { encoding: null });
} catch (err) {
  pfx = null;
  if (err.code !== 'ENOENT') {
    throw err;
  }
}

const server = pfx ? https.createServer({ pfx: pfx, passphrase: 'node' }, app).listen(app.get('port')) : app.listen(app.get('port'));
module.exports = server;

process.once('SIGINT', () => {
  server.once('close', () => {
    console.log('Server clean-up finished.');
    process.exit(0);
  });
  server.close();
  server.getConnections((err, count) => {
    if (err) {
      console.error(err.stack);
      process.exit(1);
      return;
    }
    if (count > 0) {
      console.log('Waiting for ' + count + ' open connections to close themselves.');
    }
  });

  process.on('SIGINT', () => {
    console.log('Forcing the server shut-down.');
    process.exit(0);
  });
});
