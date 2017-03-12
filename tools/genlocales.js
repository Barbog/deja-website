#!/usr/bin/env node
'use strict';

let output = {};

let path = require('path');
let root = path.join(__dirname, '..');
let locales = path.join(root, 'locales', 'en.json');

let fs = require('fs');

let sitemap = [];
let iterateMap = shallow => {
  if (Array.isArray(shallow)) {
    shallow.forEach(item => {
      sitemap[sitemap.length] = item.title;
      iterateMap(item.subpages);
    });
  }
};
iterateMap(JSON.parse(fs.readFileSync(path.join(root, 'sitemap.json'), { encoding: 'utf8' })));
sitemap.filter(item => typeof item === 'string').sort().forEach(item => { output[item] = item; });

let spawnSync = require('child_process').spawnSync;

spawnSync('git', [ 'grep', '-Fe', '__(\'', '--', 'views' ], { cwd: root, encoding: 'utf8', stdio: 'pipe' })
  .stdout.split('\n')
  .map(line => line.split('__(\'')).filter(line => line.length > 1).map(line => line[1])
  .map(line => line.split('\')')[0])
  .filter(item => typeof item === 'string').sort().forEach(line => { output[line] = line; });

let questions = [];
let iterateQs = shallow => {
  if (Array.isArray(shallow.questions)) {
    shallow.questions.forEach(item => {
      questions[questions.length] = item.question;
      item.answers.forEach(item => { questions[questions.length] = item; });
      questions[questions.length] = item.expectedAnswer;
    });
  } else {
    for (let key in shallow) {
      if (shallow.hasOwnProperty(key)) {
        iterateQs(shallow[key]);
      }
    }
  }
};
iterateQs(JSON.parse(fs.readFileSync(path.join(root, 'questions.json'), { encoding: 'utf8' })));
questions.filter(item => typeof item === 'string').sort().forEach(item => { output[item] = item; });

let visaApplication = [];
JSON.parse(fs.readFileSync(path.join(root, 'visa-application.json'), { encoding: 'utf8' })).forEach(section => {
  visaApplication[visaApplication.length] = section.title;
  if (section.subtitle) { visaApplication[visaApplication.length] = section.subtitle; }
  if (section.questions) { section.questions.forEach(question => {
    visaApplication[visaApplication.length] = question.title;
    if (question.subtitle) { visaApplication[visaApplication.length] = question.subtitle; }
    if (question.answers) { question.answers.forEach(answer => {
      visaApplication[visaApplication.length] = answer;
    }); }
  }); }
});
visaApplication.filter(item => typeof item === 'string').sort().forEach(item => { output[item] = item; });

fs.writeFileSync(locales, JSON.stringify(output, null, '\t') + '\n', { encoding: 'utf8' });
