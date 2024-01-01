"use strict";

const dgram = require("dgram");
const Buffer = require("buffer").Buffer;
const urlParse = require("url").parse;
const crypto = require("crypto");

module.exports.getPeers = (torrent, callback) => {
  const socket = dgram.createSocket("udp4");
  const url = torrent.announce.toString("utf8");

  // 1. send connect request
  udpSend(socket, buildConnReq(), url);

  socket.on("message", (response) => {
    if (respType(response) === "connect") {
      // 2. receive and parse connect response (now we have the connection id)
      const connResp = parseConnResp(response);
      // 3. send announce request (this is where we tell the tracker which files we’re interested)
      const announceReq = buildAnnounceReq(connResp.connectionId, torrent);
      udpSend(socket, announceReq, url, () => {
        console.log("message sent");
      });
    } else if (respType(response) === "announce") {
      // 4. parse announce response
      const announceResp = parseAnnounceResp(response);
      // 5. pass peers to callback
      callback(announceResp.peers);
    }
  });
};

function udpSend(socket, message, rawUrl, maxRetries = 5, callback = () => {}) {
  const url = urlParse(rawUrl);
  const timeout = 15; // initial timeout in seconds
  let retryCount = 0;

  function sendMessage() {
    socket.send(message, 0, message.length, url.port, url.hostname, (err) => {
      if (err) {
        // Handle send error
        console.error("Error sending UDP message:", err);
        return;
      }

      // Set a timeout for receiving the response
      const timeoutId = setTimeout(() => {
        if (retryCount < maxRetries) {
          // Retry if maxRetries not reached
          retryCount++;
          console.log("Retrying UDP message. Attempt:", retryCount);
          sendMessage();
        } else {
          // Max retries reached, consider the operation failed
          console.error("Max retries reached. UDP message failed.");
        }
      }, timeout * Math.pow(2, retryCount) * 1000); // Timeout in milliseconds

      // Listen for the response
      socket.once("message", (response) => {
        // Clear the timeout when a response is received
        clearTimeout(timeoutId);

        // Process the response as needed
        console.log("Received UDP response:", response.toString());
      });
    });
  }

  // Start the initial message send
  sendMessage();
}

function respType(resp) {
  const action = resp.readUInt32BE(0);
  if (action === 0) return "connect";
  if (action === 1) return "announce";

  throw Error("Unhandled Response type");
}

function buildConnReq() {
  /*
    1- Choose a random transaction ID.
    2- Fill the connect request structure.
    3- Send the packet.

    message format:
    Offset  Size            Name            Value
    0       64-bit integer  protocol_id     0x41727101980 // magic constant
    8       32-bit integer  action          0 // connect
    12      32-bit integer  transaction_id

    reference: https://www.bittorrent.org/beps/bep_0015.html
    */
  const buf = Buffer.alloc(16);

  // connection  id
  buf.writeUInt32BE(0x417, 0);
  buf.writeUInt32BE(0x27101980, 4);
  // action
  buf.writeUInt32BE(0, 8);
  // transaction id
  crypto.randomBytes(4).copy(buf, 12);

  return buf;
}

function parseConnResp(resp) {
  /*
    1- Receive the packet.
    2- Check whether the packet is at least 16 bytes.
    3- Check whether the transaction ID is equal to the one you chose.
    4- Check whether the action is connect.
    5- Store the connection ID for future use.

    message format:
    Offset  Size            Name            Value
    0       32-bit integer  action          0 // connect
    4       32-bit integer  transaction_id
    8       64-bit integer  connection_id
  */

  return {
    action: resp.readUInt32BE(0),
    transactionId: resp.readUInt32BE(4),
    connectionId: resp.slice(8),
  };
}

function buildAnnounceReq(connId, torrent, port = 6881) {
  /*
    1- Choose a random transaction ID.
    2- Fill the announce request structure.
    3- Send the packet.

    Message format:
    Offset  Size    Name    Value
    0       64-bit integer  connection_id
    8       32-bit integer  action          1 // announce
    12      32-bit integer  transaction_id
    16      20-byte string  info_hash
    36      20-byte string  peer_id
    56      64-bit integer  downloaded
    64      64-bit integer  left
    72      64-bit integer  uploaded
    80      32-bit integer  event           0 // 0: none; 1: completed; 2: started; 3: stopped
    84      32-bit integer  IP address      0 // default
    88      32-bit integer  key
    92      32-bit integer  num_want        -1 // default
    96      16-bit integer  port
  */
  const buf = Buffer.allocUnsafe(98);

  // connection id
  connId.copy(buf, 0);
  // action
  buf.writeUInt32BE(1, 8);
  // transaction id
  crypto.randomBytes(4).copy(buf, 12);
  // info hash
  torrentParser.infoHash(torrent).copy(buf, 16);
  // peerId
  util.genId().copy(buf, 36);
  // downloaded
  Buffer.alloc(8).copy(buf, 56);
  // left
  torrent.Parser.size(torrent).copy(buf, 64);
  // uploaded
  Buffer.alloc(8).copy(buf, 72);
  // event
  buf.writeUInt32BE(0, 80);
  // ip address
  buf.writeUInt32BE(0, 80);
  // key
  crypto.randomBytes(4).copy(buf, 88);
  // num want
  buf.writeInt32BE(-1, 92);
  // port
  buf.writeUInt16BE(port, 96);

  return buf;
}

function parseAnnounceResp(resp) {
  /*
    1- Receive the packet.
    2- Check whether the packet is at least 20 bytes.
    3- Check whether the transaction ID is equal to the one you chose.
    4- Check whether the action is announce.
    5- Do not announce again until interval seconds have passed or an event has occurred.

    message format:
    Offset      Size            Name            Value
    0           32-bit integer  action          1 // announce
    4           32-bit integer  transaction_id
    8           32-bit integer  interval
    12          32-bit integer  leechers
    16          32-bit integer  seeders
    20 + 6 * n  32-bit integer  IP address
    24 + 6 * n  16-bit integer  TCP port
    20 + 6 * N
  */

  function group(iterable, groupSize) {
    let groups = [];
    for (let i = 0; i < iterable.length; i += groupSize) {
      groups.push(iterable.slice(i, i + groupSize));
    }
    return groups;
  }

  return {
    action: resp.readUInt32BE(0),
    transactionId: resp.readUInt32BE(4),
    leechers: resp.readUInt32BE(8),
    seeders: resp.readUInt32BE(12),
    peers: group(resp.slice(20), 6).map((address) => {
      return {
        ip: address.slice(0, 4).join("."),
        port: address.readUInt16BE(4),
      };
    }),
  };
}

/*
    * torrent.announce is: the location of the torrent’s tracker (ex: udp://tracker.coppersurfer.tk:6969/announce).
    * spec of how to send udp messages (connect/announce): https://www.bittorrent.org/beps/bep_0015.html
    * bittorrent port: spec says that the ports for bittorrent should be between 6881 and 6889
    
    ? Why tracker use udp instead of http (tcp)?
    - The main difference is that tcp guarantees that when a user sends data, the other user will receive that data in its entirety, uncorrupted, and in the correct order – but it must create a persistent connection between users before sending data and this can make tcp much slower than udp. In the case of upd, if the data being sent is small enough (less than 512 bytes) you don’t have to worry about receiving only part of the data or receiving data out of order. However, as we’ll see shortly, it’s possible that data sent will never reach its destination, and so you sometimes end up having to resend or re-request data.

    For these reasons, udp is often a good choice for trackers because they send small messages, and we use tcp for when we actually transfer files between peers because those files tend to be larger and must arrive intact.




*/
