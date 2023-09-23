const RPC = require('@hyperswarm/rpc');
const DHT = require('hyperdht');
const Hypercore = require('hypercore');
const Hyperbee = require('hyperbee');
const crypto = require('crypto');
const { peer } = require('hyperdht/lib/messages');
const exec = require('child_process').exec;

let hbee = null;
let hcore = null;
let rpc_client = null;

const getPeers = async () => {
    if (hbee.closed == true) {
        hcore = new Hypercore('./db/rpc-server');
        hbee = new Hyperbee(hcore, { keyEncoding: 'utf-8', valueEncoding: 'binary' });
        await hbee.ready();
    }

    let peers = [];
    const res = await hbee.get('dht-peers');
    if (res) {
        peers = JSON.parse(res.value);
    }
    return peers;
}

const getMyRpc_client = async () => {
    // resolved distributed hash table seed for key pair
    // const dhtSeed = (await hbee.get('dht-seed'))?.value
    // if (!dhtSeed) {
    // console.log("No dhtSeed");
    // return;
    // }

    // start distributed hash table, it is used for rpc service discovery
    const dhtSeed = crypto.randomBytes(32);
    const dht = new DHT({
        port: 50001,
        keyPair: DHT.keyPair(dhtSeed),
        bootstrap: [{ host: '127.0.0.1', port: 30001 }] // note boostrap points to dht that is started via cli
    });
    await dht.ready();
    // resolve rpc server seed for key pair

    // setup rpc server
    const rpc = new RPC({ dht });
    return rpc;
}
const reduceAddress = (address) => {
    const front_str = address.substr(0, 2);
    const back_str = address.substr(address.length - 5, 4);
    const str = front_str + "..." + back_str;
    return str;
}

const openAuction = async (key, id, price) => {
    const reduceKey = reduceAddress(key.toString('hex'));
    const msg = `Client[${reduceKey}] opens auction: sell Pic#${id} for ${price} USDt`;
    console.log(msg);
    const payload = { id: id, price: price };
    const payloadRaw = Buffer.from(JSON.stringify(payload), 'utf-8');
    let resp = await rpc_client.request(key, 'openAuction', payloadRaw);
    resp = JSON.parse(resp);
    console.log(resp + '\n');
}

const makeBid = async (key, id, price) => {
    const reduceKey = reduceAddress(key.toString('hex'));
    const msg = `Client[${reduceKey}] makes bid : Pic#${id} for ${price} USDt`;
    console.log(msg);
    const payload = { id: id, price: price };
    const payloadRaw = Buffer.from(JSON.stringify(payload), 'utf-8');
    let resp = await rpc_client.request(key, 'makeBid', payloadRaw); //Client#2
    resp = JSON.parse(resp);
    console.log(resp + '\n');
}

const closeAuction = async (key) => {
    const reduceKey = reduceAddress(key.toString('hex'));
    const msg = `Client[${reduceKey}] close auction`;
    console.log(msg);
    const payload = { id: 0 };
    const payloadRaw = Buffer.from(JSON.stringify(payload), 'utf-8');
    let resp = await rpc_client.request(key, 'closeAuction', payloadRaw); //Client#1
    resp = JSON.parse(resp);
    console.log(resp + '\n');
}

const test = async () => {
    // Run boostrap node:
    // const cmd = "hyperdht --bootstrap --host 127.0.0.1 --port 30001";
    // exec(cmd, function (err, stdout, stderr) {
    // });
    // hyperbee db
    hcore = new Hypercore('./db/rpc-server');
    hbee = new Hyperbee(hcore, { keyEncoding: 'utf-8', valueEncoding: 'binary' });
    await hbee.ready();

    let peers = await getPeers();
    console.log("Running Nodes:", peers);
    if (peers.length < 3) {
        console.log("*********** Please run more than 3 nodes before TEST ***********");
        await hbee.close();
        return;
    }
    const test_peer_key_1 = Buffer.from(peers[0].toString('hex'), 'hex');
    const test_peer_key_2 = Buffer.from(peers[1].toString('hex'), 'hex');
    const test_peer_key_3 = Buffer.from(peers[2].toString('hex'), 'hex');

    console.log("*********** Test case as required. ***********");
    rpc_client = await getMyRpc_client();
    // close hbee
    await hbee.close();
    await hcore.close();

    // Client#1 opens auction: sell Pic#1 for 75 USDt
    await openAuction(test_peer_key_1, 1, 75); //Client#1

    // Client#2 opens auction: sell Pic#2 for 60 USDt
    await openAuction(test_peer_key_2, 2, 60); //Client#2

    // Client#2 makes bid for Client#1->Pic#1 with 75 USDt
    await makeBid(test_peer_key_2, 1, 75);  //Client#2

    // Client#3 makes bid for Client#1->Pic#1 with 75.5 USDt
    await makeBid(test_peer_key_3, 1, 75.5);  //Client#3

    //Client#2 makes bid for Client#1->Pic#1 with 80 USDt
    await makeBid(test_peer_key_2, 1, 80);  //Client#2

    // Client#1 closes auction
    await closeAuction(test_peer_key_1); //Client#1
    console.log('*********** Test completed! ***********');

    await rpc_client.dht.destroy();

}

test();
