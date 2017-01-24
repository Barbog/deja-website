#!/usr/bin/env node
'use strict';

const express = require('express');
const fs = require('fs');
const i18n = require('i18n');
const less = require('less');
const lessCleanCss = new (require('less-plugin-clean-css'))({ s1: true, advanced: true });
const path = require('path');
const showdown = new (require('showdown').Converter)();

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
      res.status(301);
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

const catchAll = (localeHash, locale, view, title, renderOverrides) => {
  app.get(encodeURI(localeHash[locale].toLowerCase().split(' ').join('-')), (req, res) => {
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
    fs.readFile(path.join(__dirname, 'pages', view + '.' + locale + '.md'), { encoding: 'utf8' }, (err, data) => {
      if (err) {
        fs.readFile(path.join(__dirname, 'pages', view + '.en.md'), { encoding: 'utf8' }, (err, data) => {
          if (err) {
            render('');
          } else {
            render(showdown.makeHtml(data).split('\n').join(''));
          }
        });
      } else {
        render(showdown.makeHtml(data).split('\n').join(''));
      }
    });
  });
  app.all(encodeURI(localeHash[locale]), returnBadAction);
};

[ 'Gathering', 'Burn Etiquette', 'Survival Guide', 'Participation', 'Visa Application', 'Donation', 'Network', 'FAQ', 'Log In' ].forEach((title) => {
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
    catchAll(localeHash, locale, title.toLowerCase().split(' ').join('-'), title, {});
  }
});

const treeHash = {};
i18n.__h('Tree').forEach((subhash) => {
  for (var locale in subhash) {
    if (!subhash.hasOwnProperty(locale)) { continue; }
    treeHash[locale] = subhash[locale];
  }
});

[ 'Be Present', 'Co-creation', 'Community', 'Each 1 Teach 1', 'Environmental Consciouness',
  'Fuck Commerce', 'Gifting', 'Openness', 'Participation', 'Self-expression',
  'Self Reliance' ].forEach((principle) => {
    const principleHash = {};
    const localeHash = {};

    i18n.__h(principle).forEach((subhash) => {
      for (var locale in subhash) {
        if (!subhash.hasOwnProperty(locale)) { continue; }
        principleHash[locale] = subhash[locale];
        localeHash[locale] = '/' + locale + '/' + treeHash[locale].toLowerCase().split(' ').join('-') + '/' + principleHash[locale].toLowerCase().split(' ').join('-');
      }
    });

    for (var locale in principleHash) {
      if (!principleHash.hasOwnProperty(locale)) { continue; }
      catchAll(localeHash, locale, 'tree.' + principle.toLowerCase().split(' ').join('-'), principle, { principle: principle });
    }
  });

app.use((req, res, next) => {
  res.set('Cache-Control', 'max-age=60');
  next();
});

app.get('/main.css', (req, res) => {
  fs.readFile(path.join(__dirname, 'less', 'main.less'), { encoding: 'utf8' }, (err, data) => {
    if (err) {
      res.status(500);
      res.type('text/css; charset=utf-8');
      res.send('/* Error reading file: ' + (typeof err.code === 'undefined' ? 'OOPS' : err.code) + ' */\n');
      console.error(err.stack);
    } else {
      less.render(data, {
        'include-path': [ path.join(__dirname, 'less') ],
        plugins: [ lessCleanCss ]
      }).then((out) => {
        res.status(200);
        res.type('text/css; charset=utf-8');
        res.send(out.css + '\n');
      }, (err) => {
        res.status(500);
        res.type('text/css; charset=utf-8');
        res.send('/* Error parsing file: ' + (typeof err.type === 'undefined' ? 'OOPS' : err.type) + ' */\n');
      });
    }
  });
});
app.all('/main.css', returnBadAction);

app.use(express.static(path.join(__dirname, 'static')));

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
