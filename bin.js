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
    messages: 'm',
    service: 's'
  },
  default: {
    rpc: 'rpc.js',
    messages: 'rpc-messages.js',
    service: 'RPC'
  }
})

if (!argv._.length) {
  console.error('Usage: hrpc schema.proto [--service=RPC] [--rpc=rpc.js] [--messages=rpc-messages.js]')
  process.exit(1)
}

const schema = argv._[0]
schemaSource = fs.readFileSync(schema, 'utf-8')

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

const commands = new Map()
const { services } = parse(schemaSource)

const isVoid = (type) => {
  if (messages.hasOwnProperty(type)) return false
  return type === 'NULL' || type === 'Void'
}

let service

for (const s of services) {
  if (s.name === argv.service) {
    service = s
    break
  }
}

if (!service) {
  console.error('No ' + argv.service + ' service defined in schema')
  process.exit(2)
}

let lastId = 0

for (const m of service.methods) {
  const name = m.name.slice(0, 1).toLowerCase() + m.name.slice(1)
  const cmd = {}

  cmd.name = name
  lastId = cmd.id = m.options.id ? Number(m.options.id) : (lastId + 1)
  cmd.requestEncoding = isVoid(m.input_type) ? 'RPC.NULL' : 'messages.' + m.input_type
  cmd.responseEncoding = isVoid(m.output_type) ? 'RPC.NULL' : 'messages.' + m.output_type

  commands.set(name, cmd)
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
src.push('')

src.push(
  'module.exports = class HRPCSession extends HRPC {',
  '  constructor (rawSocket) {',
  '    super()',
  '    this.rawSocket = rawSocket',
  '',
  '    const rpc = this._rpc = new RPC({ errorEncoding })',
  '    rpc.pipe(this.rawSocket).pipe(rpc)',
  '    rpc.on(\'close\', () => this.emit(\'close\'))',
  '    rpc.on(\'error\', (err) => {',
  '      if (this.listenerCount(\'error\')) this.emit(\'error\', err)',
  '    })'
)

for (const [name, cmd] of commands) {
  src.push('')
  src.push('    this._' + name + ' = this._rpc.defineMethod({')
  src.push('      id: ' + cmd.id + ',')
  src.push('      requestEncoding: ' + cmd.requestEncoding + ',')
  src.push('      responseEncoding: ' + cmd.responseEncoding + ',')
  src.push('    })')
}

src.push('  }')
src.push('')
src.push('  onRequest (context, handlers) {')
src.push('    if (!handlers) {')
src.push('      handlers = context')
src.push('      context = null')
src.push('    }')
for (const [name, cmd] of commands) {
  src.push('    if (handlers.' + name + ') this._' + name + '.onrequest = handlers.' + name + '.bind(context)')
}
src.push('  }')

for (const [name, cmd] of commands) {
  const arg = cmd.requestEncoding !== 'RPC.NULL' ? 'data' : ''
  src.push('')
  src.push('  ' + name + ' (' + arg + ') {')
  src.push('    return this._' + name + '.request(' + arg + ')')
  src.push('  }')
  src.push('')
  src.push('  ' + name + 'NoReply (' + arg + ') {')
  src.push('    return this._' + name + '.requestNoReply(' + arg + ')')
  src.push('  }')
}

src.push('')
src.push('  destroy (err) {')
src.push('    this.rawSocket.destroy(err)')
src.push('  }')
src.push('}')


fs.writeFileSync(argv.messages, js, 'utf-8')
fs.writeFileSync(argv.rpc, src.join(EOL) + EOL, 'utf-8')
