#!/usr/bin/env node
'use strict';

let path = require('path');
let root = path.join(__dirname, '..');
let locales = path.join(root, 'locales', 'en.json');

let fs = require('fs');
fs.writeFileSync(locales, '{}');

let server = require(path.join(root, 'server'));
server.close();

let output = JSON.parse(fs.readFileSync(locales, { encoding: 'utf8' }));

let spawnSync = require('child_process').spawnSync;

spawnSync('git', [ 'grep', '-Fe', '__(\'', '--', 'views' ], { cwd: root, encoding: 'utf8', stdio: 'pipe' })
  .stdout.split('\n')
  .map(line => line.split('__(\'')).filter(line => line.length > 1).map(line => line[1])
  .map(line => line.split('\')')[0])
  .sort().forEach(line => { output[line] = line; });

fs.writeFileSync(locales, JSON.stringify(output, null, '\t') + '\n', { encoding: 'utf8' });
