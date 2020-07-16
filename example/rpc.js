const messages = require('./rpc-messages')
const HRPC = require('hrpc-runtime')
const RPC = require('hrpc-runtime/rpc')

const errorEncoding = {
  encode: messages.RPCError.encode,
  encodingLength: messages.RPCError.encodingLength,
  decode (buf, offset) {
    const { message, code, errno, details } = messages.RPCError.decode(buf, offset)
    errorEncoding.decode.bytes = messages.RPCError.decode.bytes
    const err = new Error(message)
    err.code = code
    err.errno = errno
    err.details = details
    return err
  }
}

class HRPCServiceTest {
  constructor (rpc) {
    const service = rpc.defineService({ id: 2 })

    this._test = service.defineMethod({
      id: 5,
      requestEncoding: messages.TestRequest,
      responseEncoding: messages.TestResponse
    })

    this._boring = service.defineMethod({
      id: 6,
      requestEncoding: RPC.NULL,
      responseEncoding: RPC.NULL
    })
  }

  onRequest (context, handlers = context) {
    if (handlers.test) this._test.onrequest = handlers.test.bind(context)
    if (handlers.boring) this._boring.onrequest = handlers.boring.bind(context)
  }

  test (data) {
    return this._test.request(data)
  }

  testNoReply (data) {
    return this._test.requestNoReply(data)
  }

  boring () {
    return this._boring.request()
  }

  boringNoReply () {
    return this._boring.requestNoReply()
  }
}

module.exports = class HRPCSession extends HRPC {
  constructor (rawSocket, { maxSize = 2 * 1024 * 1024 * 1024 } = {}) {
    super()

    this.rawSocket = rawSocket
    this.rawSocketError = null
    rawSocket.on('error', (err) => {
      this.rawSocketError = err
    })

    const rpc = new RPC({ errorEncoding, maxSize })
    rpc.pipe(this.rawSocket).pipe(rpc)
    rpc.on('close', () => this.emit('close'))
    rpc.on('error', (err) => {
      if ((err !== this.rawSocketError && !isStreamError(err)) || this.listenerCount('error')) this.emit('error', err)
    })

    this.test = new HRPCServiceTest(rpc)
  }

  destroy (err) {
    this.rawSocket.destroy(err)
  }
}

function isStreamError (err) {
  return err.message === 'Writable stream closed prematurely' || err.message === 'Readable stream closed prematurely'
}
