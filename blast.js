#!/usr/bin/env node
'use strict'

const argv = process.argv.slice(2)
let year = parseInt(argv[0], 10)
let subject = argv[1]
let textFile = argv[2]
let htmlFile = argv[3]
if (typeof htmlFile !== 'string' || htmlFile === '') htmlFile = null
let sender = argv[4]
if (typeof sender !== 'string' || sender === '') sender = 'Degošie Jāņi <game@sparklatvia.lv>'

if (argv.length > 5 ||
    isNaN(year) ||
    typeof subject !== 'string' || subject === '' ||
    typeof textFile !== 'string' || textFile === '') {
  console.error('Usage: ' + process.argv[1] + ' \\\n  <year> \\\n  <subject> \\\n  <text file> \\\n  [html file] \\\n  [sender]\n')
  console.error('Example: ' + process.argv[1] + ' \\\n  2017 \\\n  "Donations for DeJā 2017" \\\n  blast.donations.txt \\\n  blast.donations.html \\\n  "Ministry of Finance <ministry-of-finance@sparklatvia.lv>"\n')
  process.exit(1)
}

const fs = require('fs')
const path = require('path')

let text = fs.readFileSync(textFile, { encoding: 'utf8' })
let html = htmlFile ? fs.readFileSync(htmlFile, { encoding: 'utf8' }) : undefined

const readJsonFileSync = filename => JSON.parse(fs.readFileSync(path.join(__dirname, filename), { encoding: 'utf8' }))

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
const mailgun = require('mailgun-js')({ apiKey: getKey('mailgun'), domain: 'sparklatvia.lv' })
const redis = require('redis')

const db = redis.createClient()
db.on('error', err => {
  console.error(err.stack)
})

async.map([ 'invited:' + year + ':veteran', 'invited:' + year + ':virgin' ], (key, callback) => {
  db.lrange(key, 0, 1000, callback)
}, (err, groups) => {
  if (err) {
    throw err
  }

  db.quit()

  let invitees = groups.reduce((array, group) => array.concat(group), [])
  invitees.forEach(invitee => {
    mailgun.messages().send({
      from: sender,
      to: invitee,
      subject,
      text,
      html
    }, err => {
      if (err) {
        console.error(err.message + ': ' + invitee)
      } else {
        console.log('OK: ' + invitee)
      }
    })
  })
})
