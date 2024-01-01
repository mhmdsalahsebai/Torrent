"use strict";

const fs = require("fs");
const decode = require("btparse");
const crypto = require("crypto");

module.exports.open = (filepath) => {
  return decode(fs.readFileSync(filepath));
};

module.exports.size = (torrent) => {
  const buf = Buffer.alloc(8);

  const size = torrent.info.files
    ? torrent.info.files.map((file) => file.length).reduce((a, b) => a + b)
    : torrent.info.length;

  buf.writeBigInt64BE(BigInt(size));

  return buf;
};

module.exports.infoHash = (torrent) => {
  const info = bencode.encode(torrent.info);

  return crypto.createHash("sha1").update(info).digest();
};

/*
    Useful Notes:
    * readFileSync return Buffer https://nodejs.org/api/buffer.html
    * We need to encode this buffer to convert it to string (utf8)
    * torrent files serialized in bencode format, that's why we needed bencode package to deserialize it.
    * We must send the info hash as part of the request to the tracker, we’re saying we want the list of peers that can share this exact torrent.
*/
