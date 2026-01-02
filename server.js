#!/usr/bin/env node

const charset = require('charset')
const http = require('http')
const { decode, encode } = require('iconv-lite')

const port = process.env.PORT || 3000
const time = process.env.ARCHIVE_TIME || ''
const proxyName = 'timeprox'
const timeFallback = '19980101000000'

process.on('uncaughtException', e => {
	console.error(e)
})
process.on('unhandledRejection', e => {
	throw e
})

const pad = v => `${v.toString().length === 1 ? '0' : ''}${v}`

const formatOffset = date => {
	const offset = date.getTimezoneOffset()
	const p = offset < 0 ? '+' : '-'
	const h = pad(Math.floor(Math.abs(offset) / 60))
	const m = pad(Math.abs(offset) % 60)
	return `${p}${h}:${m}`
}

const formatDate = (date = new Date()) => {
	const y = date.getFullYear()
	const m = pad(date.getMonth() + 1)
	const d = pad(date.getDate())
	const h = pad(date.getHours())
	const n = pad(date.getMinutes())
	const s = pad(date.getSeconds())
	const z = `${formatOffset(date)}`
	return `${y}-${m}-${d}T${h}:${n}:${s}${z}`
}

const log = msg => {
	console.log(`[${formatDate()}] ${msg}`)
}

const arcUrl = url => {
	const { pathname } = new URL(url)
	return /^\/web\/\d+((fw|im)_)?\//.test(pathname)
		? `https://web.archive.org${pathname}`
		: `https://web.archive.org/web/${time}${timeFallback.slice(time.length)}/${url}`
}

const filterBody = body =>
	body
		.replace(/https:\/\/web\.archive\.org\//gi, 'http://web.archive.org/')
		.replace(/(https?:\/\/web\.archive\.org)?\/web\/\d+(\/|fw_\/)/g, '')
		.replace(/^[\s\t\r\n]+</i, '<')
		.replace(
			/(<head[^>]*>)(.|[\r\n])*<!-- End Wayback Rewrite JS Include -->/i,
			'$1'
		)
		.replace(
			/(<html[^>]*>)(.|[\r\n])*<!-- End Wayback Rewrite JS Include -->/i,
			'$1'
		)

const isStartOf = (substr, str) =>
	`${str || ''}`.slice(0, substr.length) === substr

const isFetchResText = fetchRes => {
	const contentType = fetchRes.headers.get('content-type')
	return !!['text/html', 'text/plain'].find(type =>
		isStartOf(type, contentType)
	)
}

const isFetchResTs404 = fetchRes => fetchRes.headers.get('x-ts') === '404'

const isFetchResYear = (setYear, fetchRes) =>
	isStartOf(`/web/${setYear}`, new URL(fetchRes.url).pathname)

const setContentType = (fetchRes, res) => {
	const { headers } = fetchRes
	const contentType = headers.get('content-type')

	if (!contentType) {
		const guessedContentType = headers.get('x-archive-guessed-content-type')
		const guessedCharset = headers.get('x-archive-guessed-charset')
		const mimeCharset = guessedCharset ? `; charset=${guessedCharset}` : ''

		if (guessedContentType && guessedCharset) {
			res.setHeader('content-type', `${guessedContentType}${mimeCharset}`)
		}
	}

	res.setHeader('content-type', contentType)
}

const setHeaders = (fetchRes, req, res) => {
	const headers = fetchRes.headers.entries()

	Object.keys(headers).forEach(name => {
		if (['content-encoding', 'link', 'transfer-encoding'].includes(name)) return
		if ([/^x-archive-(?!orig)/].find(r => r.test(name))) return
		res.setHeader(name.replace(/^x-archive-orig-/, ''), headers[name])
	})

	res.setHeader(`x-${proxyName}-archive-url`, fetchRes.url)
	res.setHeader(`x-${proxyName}-request-time`, formatDate())
	res.setHeader(`x-${proxyName}-request-url`, req.url)
	setContentType(fetchRes, res)
}

const sendBody = async (fetchRes, res) => {
	const body = Buffer.from(await fetchRes.arrayBuffer())

	if (!isFetchResText(fetchRes)) {
		res.end(body)
		return
	}

	const contentType = res.getHeader('content-type')
	const bodyCharset =
		fetchRes.headers.get('x-archive-guessed-charset') || 'utf8'
	// Need to rewrite this to use decodeStream instead but we need to know the
	// charset from the response. Chicken and egg.
	// https://github.com/pillarjs/iconv-lite/wiki/Use-Buffers-when-decoding
	const src = decode(body, bodyCharset)
	const filtered = filterBody(src)
	const resBody = encode(filtered, 'utf8')
	res.end(resBody, 'utf8')
}

const notFound = (res, url) => {
	console.error('Not Found', url)
	return res.writeHead(404).end(`${proxyName}: Not Found`)
}

const serverError = (res, e) => {
	console.error(e)
	return res.writeHead(500).end(`${proxyName}: Server Error\n\n${e}`)
}

const server = http.createServer((req, res) => {
	fetch(arcUrl(req.url))
		.then(fetchRes => {
			log(`${req.url} => ${fetchRes.url}`)
			if (isFetchResTs404(fetchRes)) return notFound(res, fetchRes.url)
			setHeaders(fetchRes, req, res)
			return sendBody(fetchRes, res)
		})
		.catch(e => serverError(res, e))
})

log(`HTTP Proxy: http://localhost:${port}`)
server.listen(port)
