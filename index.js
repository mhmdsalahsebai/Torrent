"use strict";

const tracker = require("./src/tracker");
const torrentParser = require("./src/torrent-parser");
const download = require("./src/download");

const torrent = torrentParser.open(process.argv[2]);

download(torrent);
