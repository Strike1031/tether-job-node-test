const RPC = require('@hyperswarm/rpc')
const DHT = require('hyperdht')
const Hypercore = require('hypercore')
const Hyperbee = require('hyperbee')
const crypto = require('crypto')

let hbee = null;
let hcore = null;
let rpc = null;
let pubKey = null;

let auction = {
    id: 0, price: 0
}
let lastBid = {
    client: '', price: 0
}


const getPeers = async () => {
    await hbee.close();
    await hcore.close();
    hcore = new Hypercore('./db/rpc-server');
    hbee = new Hyperbee(hcore, { keyEncoding: 'utf-8', valueEncoding: 'binary' });
    await hbee.ready();
    let peers = [];
    const res = await hbee.get('dht-peers');
    if (res) {
        peers = JSON.parse(res.value);
    }
    // console.log(peers);
    return peers;
    
}

const setPeers = async (pubKey) => {
    let peers = await getPeers();
    peers.push(pubKey);
    await hbee.put('dht-peers', JSON.stringify(peers));
    await hbee.close();
}

const sendRequest = async (pubKey, method, msg) => {
    const payload = Buffer.from(JSON.stringify(msg), 'utf-8');
    const binaryKey = Buffer.from(pubKey, 'hex');
    await rpc.request(binaryKey, method, payload);
}

const note = (msg) => {
    console.log(msg);
}

const reduceAddress = (address) => {
    const front_str = address.substr(0,2);
    const back_str = address.substr(address.length-5,4);
    const str = front_str + "..." + back_str;
    return str;
}

const openAuction = async (id, price) => {
    if (auction.price > 0) {
        return JSON.stringify({ status: false, msg: 'Opened auction exists on this client, please close it first!' });
    }
    auction.price = price;
    auction.id = id;
    const peers = await getPeers();
    const reduceServerKey = reduceAddress(pubKey);
    const msg = `Client[${reduceServerKey}] opens auction: sell Pic#${id} for ${price} USDt`;
    await hbee.close();
    await hcore.close();
    for (let i = 0; i < peers.length; i++) {
        //if (pubKey != peers[i]) {
        await sendRequest(peers[i], 'note', msg);
        //}
    }

    return JSON.stringify({ status: true, msg: 'Success' });
}

const makeBid = async (id, price) => {
    if (!(id > 0 && price > 0)) {
        return JSON.stringify({ status: false, msg: 'Invalid Picture ID or Price.' });
    }
    const peers = await getPeers();
    await hbee.close();
    await hcore.close();
    for (let i = 0; i < peers.length; i++) {
        await sendRequest(peers[i], 'manageBid', { client: pubKey, id: id, price: price });
        
    }
    return JSON.stringify({ status: true, msg: 'Success' });
}

const manageBid = async (client, id, price) => {
    if (auction.id != id || auction.price > price) {
        return JSON.stringify({ status: false, msg: 'Invalid Picture ID or Price' });
    }

    if (lastBid.price > 0 && lastBid.price >= price) {
        return JSON.stringify({ status: false, msg: 'Should be bigger than last bid Price' });
    }

    lastBid.client = client;
    lastBid.price = price;
    const reduceServerKey = reduceAddress(pubKey);
    const reduceClient = reduceAddress(client);
    const msg = `Client[${reduceClient}] makes bid for Client[${reduceServerKey}]: Pic#${id} for ${price} USDt`;
    const peers = await getPeers();
    await hbee.close();
    await hcore.close();
    for (let i = 0; i < peers.length; i++) {
        await sendRequest(peers[i], 'note', msg);
    }
    return JSON.stringify({ status: true, msg: 'Success' });
}

const closeAuction = async () => {
    if (lastBid.price == 0) {
        return JSON.stringify({ status: false, msg: 'No opened auction' });
    }
    const peers = await getPeers();
    const reduceServerKey = reduceAddress(pubKey);
    const reduceLastClient = reduceAddress(lastBid.client);
    const msg = `Client[${reduceServerKey}] close auction: sell Pic#${auction.id} for ${lastBid.price} USDt to Client[${reduceLastClient}]`;
    await hbee.close();
    await hcore.close();
    for (let i = 0; i < peers.length; i++) {
        await sendRequest(peers[i], 'note', msg);
    }
    auction.price = 0;
    auction.id = 0;
    lastBid.client = '';
    lastBid.price = 0;

    return JSON.stringify({ status: true, msg: 'Success' });
}

const initialize = async () => {
    // hyperbee db
    hcore = new Hypercore('./db/rpc-server')
    hbee = new Hyperbee(hcore, { keyEncoding: 'utf-8', valueEncoding: 'binary' })
    await hbee.ready()

    // resolved distributed hash table seed for key pair
    let dhtSeed = (await hbee.get('dht-seed'))?.value
    if (!dhtSeed) {
        // not found, generate and store in db
        dhtSeed = crypto.randomBytes(32)
        await hbee.put('dht-seed', dhtSeed)
    }
    // start distributed hash table, it is used for rpc service discovery
    const dht = new DHT({
        port: 40001,
        keyPair: DHT.keyPair(dhtSeed),
        bootstrap: [{ host: '127.0.0.1', port: 30001 }] // note boostrap points to dht that is started via cli
    })
    await dht.ready()
    // resolve rpc server seed for key pair
    rpcSeed = crypto.randomBytes(32)
    // setup rpc server
    rpc = new RPC({ seed: rpcSeed, dht })
}

const start = async () => {
    const rpcServer = rpc.createServer()

    // bind handlers to rpc server
    rpcServer.respond('note', async (reqRaw) => {
        // reqRaw is Buffer, we need to parse it
        const req = JSON.parse(reqRaw.toString('utf-8'));
        note(req);
    });

    rpcServer.respond('openAuction', async (reqRaw) => {
        // reqRaw is Buffer, we need to parse it
        const req = JSON.parse(reqRaw.toString('utf-8'));
        const resp = await openAuction(req.id, req.price);

        // we also need to return buffer response
        const respRaw = Buffer.from(JSON.stringify(resp), 'utf-8')
        return respRaw
    });

    rpcServer.respond('makeBid', async (reqRaw) => {
        // reqRaw is Buffer, we need to parse it
        const req = JSON.parse(reqRaw.toString('utf-8'));
        const resp = await makeBid(req.id, req.price);

        // we also need to return buffer response
        const respRaw = Buffer.from(JSON.stringify(resp), 'utf-8')
        return respRaw
    });

    rpcServer.respond('manageBid', async (reqRaw) => {
        // reqRaw is Buffer, we need to parse it
        const req = JSON.parse(reqRaw.toString('utf-8'));
        const resp = await manageBid(req.client, req.id, req.price);

        // we also need to return buffer response
        const respRaw = Buffer.from(JSON.stringify(resp), 'utf-8')
        return respRaw
    });

    rpcServer.respond('closeAuction', async () => {
        // reqRaw is Buffer, we need to parse it
        const resp = await closeAuction();

        // we also need to return buffer response
        const respRaw = Buffer.from(JSON.stringify(resp), 'utf-8')
        return respRaw
    });


    await rpcServer.listen();
    pubKey = rpcServer.publicKey.toString('hex');
    console.log('rpc server started listening on public key:', pubKey);

    // const binaryKey = Buffer.from(pubKey, 'hex');
    // const client = rpc.connect(binaryKey);
    // client.on('close', async ()=> {
    //     console.log('Close this node');
    //     await cleanup();
    // });

    await setPeers(pubKey);
    // console.log('Clients: ', await getPeers());
}

const main = async () => {
    await initialize();
    await start();
    console.log("Waiting for Requests...");
}

main().catch(console.error);

async function cleanup() {
    console.log("Clean up the database");
    // do datbase clean 
    await hbee.close();
    await hcore.close();

    hcore = new Hypercore('./db/rpc-server');
    hbee = new Hyperbee(hcore, { keyEncoding: 'utf-8', valueEncoding: 'binary' });
    await hbee.ready();
    //Get lists of client's dhtSeed
    const nodeList = (await hbee.get('dht-peers'))?.value;

    if (nodeList == null) {
        nodeListArray = [];
    }
    else {
        nodeListArray = JSON.parse(nodeList);
    }
    const index = nodeListArray.findIndex(node => node == pubKey.toString('hex'));
    if (index > -1) { // only splice array when item is found
        nodeListArray.splice(index, 1); // 2nd parameter means remove one item only
    }
    await hbee.put('dht-peers', JSON.stringify(nodeListArray));
    await hbee.close();
    await hcore.close();
}

process.on("SIGINT", async () => {
    await cleanup();
    process.exit(0);
});
