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

module.exports = class HRPCSession extends HRPC {
  constructor (rawSocket) {
    super()
    this.rawSocket = rawSocket

    const rpc = this._rpc = new RPC({ errorEncoding })
    rpc.pipe(this.rawSocket).pipe(rpc)
    rpc.on('close', () => this.emit('close'))
    rpc.on('error', (err) => {
      if (this.listenerCount('error')) this.emit('error', err)
    })

    this._test = this._rpc.defineMethod({
      id: 1,
      requestEncoding: messages.TestRequest,
      responseEncoding: messages.TestResponse,
    })

    this._boring = this._rpc.defineMethod({
      id: 2,
      requestEncoding: RPC.NULL,
      responseEncoding: RPC.NULL,
    })
  }

  onRequest (handlers) {
    if (handlers.test) this._test.onrequest = handlers.test
    if (handlers.boring) this._boring.onrequest = handlers.boring
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

  destroy (err) {
    this.rawSocket.destroy(err)
  }
}
