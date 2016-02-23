var EventEmitter = require('events')
var util = require('util')
var getBrowserRTC = require('get-browser-rtc')
var Peer = require('./peer.js')
var transports = require('./transports.js')

module.exports = Exchange
function Exchange (id, opts) {
  if (!id || typeof id !== 'string') {
    throw new Error('A network id must be specified')
  }
  if (!(this instanceof Exchange)) {
    return new Exchange(id, opts)
  }
  EventEmitter.call(this)

  opts = opts || {}
  this._wrtc = opts.wrtc || getBrowserRTC()

  this._transports = opts.transports
  if (!opts.transports) {
    this._transports = { websocket: transports.websocket }
    if (this._wrtc) {
      this._transports.webrtc = transports.webrtc({ wrtc: this._wrtc })
    }
    // TODO: add TCP as a default transport for Node.js clients
  }

  this.id = id
  this.peers = []
  this._accepts = {}

  // lists of peers accepting connections, indexed by transport
  this._acceptPeers = {}
  for (var transportId in this._transports) {
    this._acceptPeers[transportId] = []
  }
}
util.inherits(Exchange, EventEmitter)

Exchange.prototype.getNewPeer = function (cb) {
  if (this.peers.length === 0) {
    return cb(new Error('Not connected to any peers. Connect to some seeds manually.'))
  }
  var peer = this.peers[Math.floor(Math.random() * this.peers.length)]
  peer.getNewPeer(cb)
}

Exchange.prototype.connect = function (transportId, address, cb) {
  transportId = transportId.toLowerCase()
  if (!this._transports[transportId]) {
    return cb(new Error('Transport "' + transportId + '" not found'))
  }
  var connect = this._transports[transportId].connect
  connect(address, null, (err, socket) => {
    if (err) return cb(err)
    var peer = this._createPeer(socket, true)
    peer.on('ready', () => cb(null, peer))
  })
}

Exchange.prototype._createPeer = function (socket, outgoing) {
  var peer = new Peer(this)
  peer.incoming = !outgoing
  peer.on('error', (err) => {
    this.emit('peerError', err, peer)
    this.removePeer(peer)
  })
  peer.connect(socket)
  return peer
}

Exchange.prototype.accept = function (transportId, opts) {
  transportId = transportId.toLowerCase()
  if (!this._transports[transportId]) {
    throw new Error('Transport "' + transportId + '" not found')
  }
  if (this._accepts[transportId]) {
    throw new Error('Already accepting with "' + transportId + '" transport')
  }
  var transport = this._transports[transportId]
  if (transport.accept) {
    var unaccept = transport.accept(opts, this._onConnection.bind(this))
    if (typeof unaccept !== 'function') {
      throw new Error('Transport\'s "accept" function must return a cleanup function')
    }
  }
  this._accepts[transportId] = { opts, unaccept }
  for (var peer of this.peers) {
    peer.sendAccept(transportId, opts)
  }
}

Exchange.prototype._onConnection = function (socket, outgoing) {
  var peer = this._createPeer(socket, outgoing)
  this.addPeer(peer)
}

Exchange.prototype.unaccept = function (transport) {
  for (var peer of this.peers) {
    peer.sendUnaccept(transport)
  }
  var unaccept = this._accepts[transport].unaccept
  delete this._accepts[transport]
  unaccept()
}

Exchange.prototype.addPeer = function (peer) {
  this.peers.push(peer)
  this.emit('peer', peer)
}

Exchange.prototype.removePeer = function (peer) {
  peer.destroy()
  for (var transportId of Object.keys(peer._remoteAccepts)) {
    remove(this._acceptPeers[transportId], peer)
  }
  return remove(this.peers, peer)
}

Exchange.prototype._error = function (err) {
  this.emit('error', err)
}

Exchange.prototype._getLocalAddresses = function (cb) {
  // TODO: get all local addresses across all peers
}

function remove (array, object) {
  var index = array.indexOf(object)
  if (index !== -1) {
    array.splice(index, 1)
    return true
  }
  return false
}
