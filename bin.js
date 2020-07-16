#!/usr/bin/env node

const path = require('path')
const minimist = require('minimist')
const protobuf = require('protocol-buffers')
const { parse } = require('protocol-buffers-schema')
const fs = require('fs')
const { EOL } = require('os')

const argv = minimist(process.argv.slice(2), {
  alias: {
    rpc: 'r',
    messages: 'm'
  },
  default: {
    rpc: 'rpc.js',
    messages: 'rpc-messages.js'
  }
})

if (!argv._.length) {
  console.error('Usage: hrpc schema.proto [--rpc=rpc.js] [--messages=rpc-messages.js]')
  process.exit(1)
}

const schema = argv._[0]
let schemaSource = fs.readFileSync(schema, 'utf-8')

const { messages } = parse(schemaSource)

if (!messages.RPCError) {
  schemaSource += `
    message RPCError {
      required string message = 1;
      optional string code = 2;
      optional int32 errno = 3;
      optional string details = 4;
    }
  `
}

const js = protobuf.toJS(schemaSource, {
  inlineEnc: true,
  encodings: 'hrpc-runtime/encodings'
})

const { services } = parse(schemaSource)

const isVoid = (type) => {
  if (messages.hasOwnProperty(type)) return false
  return type === 'NULL' || type === 'Void' || type === 'hrpc.Void'
}

let req = path.relative(path.dirname(argv.rpc), argv.messages)
if (req[0] !== '.') req = './' + req
req = req.replace(/\\/g, '/').replace(/\.js$/, '')

const src = []

src.push('const messages = require(\'' + req + '\')')
src.push('const HRPC = require(\'hrpc-runtime\')')
src.push('const RPC = require(\'hrpc-runtime/rpc\')')
src.push('')

src.push(
  'const errorEncoding = {',
  '  encode: messages.RPCError.encode,',
  '  encodingLength: messages.RPCError.encodingLength,',
  '  decode (buf, offset) {',
  '    const { message, code, errno, details } = messages.RPCError.decode(buf, offset)',
  '    errorEncoding.decode.bytes = messages.RPCError.decode.bytes',
  '    const err = new Error(message)',
  '    err.code = code',
  '    err.errno = errno',
  '    err.details = details',
  '    return err',
  '  }',
  '}'
)

let lastServiceId = 0

const camelize = (name) => {
  if (name === name.toUpperCase()) return name
  return name.slice(0, 1).toLowerCase() + name.slice(1)
}

const serviceId = service => {
  if (service.options.id) return Number(service.options.id)
  if (service.options['hrpc.service']) return Number(service.options['hrpc.service'])
  return null
}

const methodId = method => {
  if (method.options.id) return Number(method.options.id)
  if (method.options['hrpc.method']) return Number(method.options['hrpc.method'])
  return null
}

for (const service of services) {
  const id = lastServiceId = serviceId(service) || (lastServiceId + 1)

  src.push('')
  src.push('class HRPCService' + service.name + ' {')
  src.push('  constructor (rpc) {')
  src.push('    const service = rpc.defineService({ id: ' + id + ' })')

  let lastMethodId = 0

  for (const m of service.methods) {
    const id = lastMethodId = methodId(m) || (lastMethodId + 1)
    const name = camelize(m.name)
    const requestEncoding = isVoid(m.input_type) ? 'RPC.NULL' : 'messages.' + m.input_type
    const responseEncoding = isVoid(m.output_type) ? 'RPC.NULL' : 'messages.' + m.output_type

    src.push('')
    src.push('    this._' + name + ' = service.defineMethod({')
    src.push('      id: ' + id + ',')
    src.push('      requestEncoding: ' + requestEncoding + ',')
    src.push('      responseEncoding: ' + responseEncoding)
    src.push('    })')
  }

  src.push('  }')
  src.push('')
  src.push('  onRequest (context, handlers = context) {')
  for (const m of service.methods) {
    const name = camelize(m.name)
    src.push('    if (handlers.' + name + ') this._' + name + '.onrequest = handlers.' + name + '.bind(context)')
  }
  src.push('  }')

  for (const m of service.methods) {
    const name = camelize(m.name)
    const arg = isVoid(m.input_type) ? '' : 'data'

    src.push('')
    src.push('  ' + name + ' (' + arg + ') {')
    src.push('    return this._' + name + '.request(' + arg + ')')
    src.push('  }')
    src.push('')
    src.push('  ' + name + 'NoReply (' + arg + ') {')
    src.push('    return this._' + name + '.requestNoReply(' + arg + ')')
    src.push('  }')
  }

  src.push('}')
}

src.push('')
src.push(
  'module.exports = class HRPCSession extends HRPC {',
  '  constructor (rawSocket, { maxSize = 2 * 1024 * 1024 * 1024 } = {}) {',
  '    super()',
  '',
  '    this.rawSocket = rawSocket',
  '    this.rawSocketError = null',
  '    rawSocket.on(\'error\', (err) => {',
  '      this.rawSocketError = err',
  '    })',
  '',
  '    const rpc = new RPC({ errorEncoding, maxSize })',
  '    rpc.pipe(this.rawSocket).pipe(rpc)',
  '    rpc.on(\'close\', () => this.emit(\'close\'))',
  '    rpc.on(\'error\', (err) => {',
  '      if ((err !== this.rawSocketError && !isStreamError(err)) || this.listenerCount(\'error\')) this.emit(\'error\', err)',
  '    })'
)

let first = true
for (const service of services) {
  if (first) {
    first = false
    src.push('')
  }
  const name = camelize(service.name)
  src.push('    this.' + name + ' = new HRPCService' + service.name + '(rpc)')
}

src.push('  }')

src.push('')
src.push('  destroy (err) {')
src.push('    this.rawSocket.destroy(err)')
src.push('  }')
src.push('}')
src.push('')

// TODO: tag streamx errors
src.push('function isStreamError (err) {')
src.push('  return err.message === \'Writable stream closed prematurely\' || err.message === \'Readable stream closed prematurely\'')
src.push('}')

fs.writeFileSync(argv.messages, js, 'utf-8')
fs.writeFileSync(argv.rpc, src.join(EOL) + EOL, 'utf-8')
