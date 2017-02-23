#!/usr/bin/env node
'use strict';

const bcrypt = require('bcryptjs');
const env = require('get-env')();
const express = require('express');
const frontMatter = require('front-matter');
const fs = require('fs');
const i18n = require('i18n');
const less = require('less');
const lessCleanCss = new (require('less-plugin-clean-css'))({ s1: true, advanced: true });
const mailgun = require('mailgun-js')({ apiKey: 'key-f092a5bb72bd024a03f67de1144de8a8', domain: 'sandboxce71f9fc94ff4e4ca40e1578b8ba3019.mailgun.org' });
const path = require('path');
const randomstring = require('randomstring');
const redis = require('redis');
const showdown = new (require('showdown').Converter)();

const db = redis.createClient();
db.on('error', (err) => {
  console.error(err.stack);
});

const app = express();
app.set('case sensitive routing', true);
app.set('env', 'production');
app.set('etag', 'strong');
app.set('port', process.env.PORT || 8080);
app.set('strict routing', true);
app.set('trust proxy', false);
app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'));
app.set('x-powered-by', false);

app.use(require('morgan')('combined'));
app.use(require('helmet')());
app.use(require('body-parser').json());
app.use(require('body-parser').urlencoded({ extended: true }));
app.use(require('cookie-parser')());
i18n.configure({
  locales: fs.readdirSync(path.join(__dirname, 'locales')).map((locale) => { return path.basename(locale, '.json'); }),
  defaultLocale: 'en',
  cookie: 'lang',
  directory: path.join(__dirname, 'locales')
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
    return;
  });
  app.all('/favicon.png', returnBadAction);
}

app.use(express.static(path.join(__dirname, 'static')));

app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.use((req, res, next) => {
  const token = req.cookies.token;

  if (typeof token !== 'string' || token === '') {
    next();
    return;
  }

  if (env === 'dev') {
    // If you have a token cookie and you are running in a development environment, we always emulate you having a session.
    res.locals.user = { email: 'john.doe@dev.local', name: 'John Doe' };
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

      res.locals.user = { email: reply, name: user.name };
      next();
    });
  });
});

app.get('/', (req, res) => {
  const localeHash = {};
  i18n.getLocales().forEach((locale) => {
    localeHash[locale] = '/' + locale + '/';
  });

  res.render('index', { altLocales: localeHash });
});
app.all('/', returnBadAction);

i18n.getLocales().forEach((locale) => {
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
    i18n.getLocales().forEach((locale) => {
      localeHash[locale] = '/' + locale + '/';
    });

    res.render('index', { altLocales: localeHash });
  });
  app.all('/' + locale + '/', returnBadAction);
});

(() => {
  const title = 'Log In';

  const catchLogin = (locale) => {
    app.get(encodeURI(localeHash[locale].toLowerCase().split(' ').join('-')), (req, res) => {
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
    app.post(encodeURI(localeHash[locale].toLowerCase().split(' ').join('-')), (req, res) => {
      req.setLocale(locale);
      const email = req.body ? req.body.email : '';
      const password = req.body ? req.body.password : '';
      const location = (req.body ? req.body.location : '') || ('/' + locale + '/');

      const rerender = () => {
        res.render('log-in', { altLocales: localeHash, title: req.__(title), markdown: '', hideNavigation: true, location: location, email: email }, (err, html) => {
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
        rerender();
        return;
      }

      db.hget('user:' + email, 'password', (err, reply) => {
        if (err || typeof reply !== 'string' || reply === '') {
          // We still want to run bcrypt to avoid timing attacks.
          reply = '';
        }

        bcrypt.compare(password, reply, (err, match) => {
          if (err || !match) {
            rerender();
            return;
          }

          const token = randomstring.generate({ length: 32, charset: 'alphanumeric' });
          const tokenExpirySeconds = 60/* s */ * 60/* m */ * 3/* h */;
          db.setex('session:' + token, tokenExpirySeconds, email, (err) => {
            if (err) {
              rerender();
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
    app.all(encodeURI(localeHash[locale].toLowerCase().split(' ').join('-')), returnBadAction);
  };

  const navbarHash = {};
  const localeHash = {};

  i18n.__h(title).forEach((subhash) => {
    for (var locale in subhash) {
      if (!subhash.hasOwnProperty(locale)) { continue; }
      navbarHash[locale] = subhash[locale];
      localeHash[locale] = '/' + locale + '/' + navbarHash[locale].toLowerCase().split(' ').join('-');
    }
  });

  for (var locale in navbarHash) {
    if (!navbarHash.hasOwnProperty(locale)) { continue; }
    catchLogin(locale);
  }
})();

(() => {
  const title = 'Log Out';

  const catchLogout = (locale) => {
    app.get(encodeURI(localeHash[locale].toLowerCase().split(' ').join('-')), (req, res) => {
      req.setLocale(locale);
      const location = (req.body ? req.body.location : '') || (req.headers ? req.headers.referer : '') || ('/' + locale + '/');
      res.cookie('token', '', { path: '/', maxAge: 1, httpOnly: true, secure: true });
      res.render('redirect', { target: location }, (err, html) => {
        res.status(307);
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
    app.all(encodeURI(localeHash[locale].toLowerCase().split(' ').join('-')), returnBadAction);
  };

  const navbarHash = {};
  const localeHash = {};

  i18n.__h(title).forEach((subhash) => {
    for (var locale in subhash) {
      if (!subhash.hasOwnProperty(locale)) { continue; }
      navbarHash[locale] = subhash[locale];
      localeHash[locale] = '/' + locale + '/' + navbarHash[locale].toLowerCase().split(' ').join('-');
    }
  });

  for (var locale in navbarHash) {
    if (!navbarHash.hasOwnProperty(locale)) { continue; }
    catchLogout(locale);
  }
})();

(() => {
  const title = 'Register';

  const catchRegister = (locale) => {
    app.get(encodeURI(localeHash[locale].toLowerCase().split(' ').join('-')), (req, res) => {
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
    app.post(encodeURI(localeHash[locale].toLowerCase().split(' ').join('-')), (req, res) => {
      req.setLocale(locale);
      const name = req.body ? req.body.name : '';
      const email = req.body ? req.body.email : '';
      const location = '/' + locale + '/' + req.__('Log In').toLowerCase().split(' ').join('-');

      const rerender = () => {
        res.render('register', { altLocales: localeHash, title: req.__(title), markdown: '', hideNavigation: true, location: location, name: name, email: email }, (err, html) => {
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
        rerender();
        return;
      }

      const password = randomstring.generate({ length: 8, readable: true, charset: 'alphanumeric' });

      bcrypt.hash(password, 10, (err, hash) => {
        if (err) {
          rerender();
          return;
        }

        // We still want to run bcrypt to avoid timing attacks.
        db.hexists('user:' + email, 'password', (err, reply) => {
          if (err) {
            rerender();
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

          db.hmset('user:' + email, 'password', hash, 'name', name, (err) => {
            if (err) {
              rerender();
              return;
            }

            mailgun.messages().send({
              from: 'Degošie Jāņi <game@sandboxce71f9fc94ff4e4ca40e1578b8ba3019.mailgun.org>',
              to: email,
              subject: 'Your registration with DeJā',
              text: 'You are in. Your password is ' + password + '.'
            }, (err) => {
              if (err) {
                rerender();
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
    app.all(encodeURI(localeHash[locale].toLowerCase().split(' ').join('-')), returnBadAction);
  };

  const navbarHash = {};
  const localeHash = {};

  i18n.__h(title).forEach((subhash) => {
    for (var locale in subhash) {
      if (!subhash.hasOwnProperty(locale)) { continue; }
      navbarHash[locale] = subhash[locale];
      localeHash[locale] = '/' + locale + '/' + navbarHash[locale].toLowerCase().split(' ').join('-');
    }
  });

  for (var locale in navbarHash) {
    if (!navbarHash.hasOwnProperty(locale)) { continue; }
    catchRegister(locale);
  }
})();

(() => {
  const title = 'Visa Application';

  const catchVisaApplication = (locale) => {
    app.get(encodeURI(localeHash[locale].toLowerCase().split(' ').join('-')), (req, res) => {
      req.setLocale(locale);

      if (!res.locals.user) {
        const target = '/' + locale + '/' + req.__('Log In').toLowerCase().split(' ').join('-');
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
        return;
      }

      const render = (markdown) => {
        res.render('visa-application', { altLocales: localeHash, title: req.__(title), markdown: markdown, hideNavigation: true }, (err, html) => {
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

      fs.readFile(path.join(__dirname, 'pages', title.toLowerCase().split(' ').join('-') + '.' + locale + '.md'), { encoding: 'utf8' }, (err, data) => {
        if (err) {
          fs.readFile(path.join(__dirname, 'pages', title.toLowerCase().split(' ').join('-') + '.en.md'), { encoding: 'utf8' }, (err, data) => {
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
    app.post(encodeURI(localeHash[locale].toLowerCase().split(' ').join('-')), (req, res) => {
      req.setLocale(locale);

      res.status(500);
      res.type('text/plain; charset=utf-8');
      res.send('Turn back now.'); // TODO
    });
    app.all(encodeURI(localeHash[locale].toLowerCase().split(' ').join('-')), returnBadAction);
  };

  const navbarHash = {};
  const localeHash = {};

  i18n.__h(title).forEach((subhash) => {
    for (var locale in subhash) {
      if (!subhash.hasOwnProperty(locale)) { continue; }
      navbarHash[locale] = subhash[locale];
      localeHash[locale] = '/' + locale + '/' + navbarHash[locale].toLowerCase().split(' ').join('-');
    }
  });

  for (var locale in navbarHash) {
    if (!navbarHash.hasOwnProperty(locale)) { continue; }
    catchVisaApplication(locale);
  }
})();

function catchAllFor(backstack, sitemap) {
  sitemap.forEach((page) => {
    if (typeof page.title !== 'string') { throw new Error('Page title not provided as a string.'); }
    if (!Array.isArray(page.subpages)) { page.subpages = []; }

    const stack = backstack.splice(0);
    stack[stack.length] = { title: {}, href: {} };

    const reduceToHref = (locale) => {
      return stack.reduce((prev, next) => { return prev + '/' + next.title[locale].toLowerCase().split(' ').join('-'); }, '/' + locale);
    };

    i18n.__h(page.title).forEach((subhash) => {
      for (var locale in subhash) {
        if (!subhash.hasOwnProperty(locale)) { continue; }
        stack[stack.length - 1].title[locale] = subhash[locale];
        stack[stack.length - 1].href[locale] = reduceToHref(locale);
      }
    });

    if (!page.hidden) {
      const catchAll = (localeHash, locale, view, title, renderOverrides) => {
        app.get(encodeURI(localeHash[locale]), (req, res) => {
          req.setLocale(locale);
          const render = (markdown) => {
            const renderParams = Object.assign({ altLocales: localeHash, title: req.__(title), markdown: markdown }, renderOverrides || {});
            res.render(view.split('.')[0], renderParams, (err, html) => {
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
        app.all(encodeURI(localeHash[locale]), returnBadAction);
      };

      for (var locale in stack[stack.length - 1].title) {
        if (!stack[stack.length - 1].title.hasOwnProperty(locale)) { continue; }
        catchAll(stack[stack.length - 1].href, locale,
          stack.map((el) => { return el.title.en.toLowerCase().split(' ').join('-'); }).join('.'),
          page, {});
      }
    }

    catchAllFor(stack, page.subpages);
  });
}
catchAllFor([], JSON.parse(fs.readFileSync(path.join(__dirname, 'sitemap.json'), { encoding: 'utf8' })));

var cssCache = null;
const renderLess = (callback) => {
  fs.readFile(path.join(__dirname, 'less', 'main.less'), { encoding: 'utf8' }, (err, data) => {
    if (err) {
      callback(err, null);
    } else {
      less.render(data, {
        'include-path': [ path.join(__dirname, 'less') ],
        plugins: [ lessCleanCss ]
      }).then((out) => {
        callback(null, out.css + '\n');
      }, (err) => {
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
  res.status(404);
  res.type('application/json; charset=utf-8');
  res.send('{}');
});

const server = app.listen(app.get('port'));

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

if (process.platform === 'win32') {
  var readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });
  readline.on('SIGINT', () => {
    process.emit('SIGINT');
  });
}
