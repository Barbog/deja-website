#!/bin/sh
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -sha256 -nodes -subj '/C=US/ST=Vermont/L=Burlington/O=Secure Security Ltd/OU=IT/CN=localhost'
openssl pkcs12 -export -inkey key.pem -in cert.pem -out cert.pfx -nodes -passout pass:node
rm key.pem cert.pem
