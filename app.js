#!/usr/bin/env node

const nodemon = require('nodemon')

nodemon({
	script: './server.js',
	ext: 'js json',
})

nodemon
	.on('start', () => {
		console.log('App has started')
	})
	.on('quit', () => {
		console.log('App has quit')
		process.exit()
	})
	.on('restart', files => {
		console.log('App restarted due to: ', files)
	})
