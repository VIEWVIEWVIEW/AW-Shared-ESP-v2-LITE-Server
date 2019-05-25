const dgram = require('dgram');
const socket = dgram.createSocket('udp4');

socket.on('error', (err) => {
    console.log(`socket error:\n${err.stack}`);
    socket.close();
});

socket.on('listening', () => {
    const address = socket.address();
    console.log(`socket listening ${address.address}:${address.port}`);
});


class Player {
    constructor(iIndex, fAbsOriginX, fAbsOriginY, fAbsOriginZ, iIsDuck, iHp, iWeapon, iTickCount, bHasBeenUpdated, iAmmo, callback) {
        this.index = Number(iIndex);
        this.absOriginX = Number(fAbsOriginX);
        this.absOriginY = Number(fAbsOriginY);
        this.absOriginZ = Number(fAbsOriginZ);
        this.isDuck = Number(iIsDuck);
        this.hp = Number(iHp);
        this.weapon = Number(iWeapon);
        this.tickCount = Number(iTickCount);
        this.hasBeenUpdated = Boolean(bHasBeenUpdated);
        this.ammo = Number(iAmmo)

        if (isNaN(this.index) || isNaN(this.absOriginX) || isNaN(this.absOriginY) || isNaN(this.absOriginZ) ||
            isNaN(this.isDuck) || isNaN(this.hp) || isNaN(this.weapon) || isNaN(this.tickCount) || isNaN(this.ammo))
                callback(new Error("argument is not a number"));
    };
};

class Client {
    constructor(strAddress, iPort, fTimestamp) {
        this.address = strAddress;
        this.port = iPort;
        this.timestamp = fTimestamp;
    };
};

const playerEntitiesMap = new Map();
const clientMap = new Map();
const tickCountMap = new Map();

socket.on('message', (msg, rinfo) => {
    //console.log(`client: ${rinfo.address}:${rinfo.port}\n${msg}\n`);
    msg = msg.toString();
    msg = msg.split('|');
    const gameIP = msg[0];
    if (String(msg[1]) === "reset") {
        playerEntitiesMap.delete(gameIP);
        clientMap.delete(gameIP);
        tickCountMap.delete(gameIP);
        return;
    };
    const tickCount = Number(msg[1]);
    msg.splice(0, 2);

    

    // update/create tick count map
    if (tickCountMap.has(gameIP)) {
        const oldTickCount = tickCountMap.get(gameIP);
        if (oldTickCount < tickCount)
            tickCountMap.set(gameIP, tickCount);
    } else {
        tickCountMap.set(gameIP, tickCount);
    };


    const rescvPlayerEntities = [];

    // create player objects
    msg.forEach((value) => {
        value = value.split(",")
        let player = new Player(value[0], value[1], value[2], value[3], value[4], value[5], value[6], tickCount, false, value[7], (error) => {
            if (error)
                return;
        });
        rescvPlayerEntities.push(player);
    });

    // check if array with gamesocket ip already exists
    if (playerEntitiesMap.has(gameIP)) {
        // get the old data from the map
        const oldPlayerEntities = playerEntitiesMap.get(gameIP);
        // check for each player
        oldPlayerEntities.forEach((oldPlayerEntity, oldIndex) => {
            rescvPlayerEntities.forEach((rescvPlayerEntity, rescvIndex) => {
                // find the corresponding entity
                if (oldPlayerEntity.index === rescvPlayerEntity.index) {
                    // Entity has been updated, so we don't have to add it later
                    rescvPlayerEntity.hasBeenUpdated = true;
                    // Update data for player if newer
                    if (oldPlayerEntity.tickCount < rescvPlayerEntity.tickCount) {
                        oldPlayerEntities[oldIndex] = rescvPlayerEntities[rescvIndex];
                    } 
                } 
            });
        });

        // Add entities which haven't been updated
        rescvPlayerEntities.forEach((rescvPlayerEntity, rescvIndex) => {
            if (rescvPlayerEntity.hasBeenUpdated === false) {
                oldPlayerEntities.push(rescvPlayerEntity);
            };
        });

        // Place update data
        playerEntitiesMap.set(gameIP, oldPlayerEntities);
    } else {
        playerEntitiesMap.set(gameIP, rescvPlayerEntities);
    };


    // client stuff
    // -----------------------------
    let client = new Client(String(rinfo.address), Number(rinfo.port), Date.now() / 1000);

    // check is array with gamesocket ip already exists
    if (clientMap.has(gameIP)) {
        oldClientMap = clientMap.get(gameIP);
        let oldClientMapHasNewClient = false; // LOL!
        // iterate through the existing map and check if the current client exists there already
        oldClientMap.forEach( (oldClient) => {
            // if the client exists, we will update the timestamp of the last connection
            if (oldClient.address === client.address && oldClient.port === client.port) {
                oldClientMapHasNewClient = true;
                oldClient.timestamp = Date.now() / 1000;
            };
        });

        // is the clientMap does not contain the new client => we add it
        if (oldClientMapHasNewClient === false) {
            oldClientMap.push(client);
            clientMap.set(gameIP, oldClientMap);
        };
    } else {
        // if the gamesocket ip has no dedicated pool => we create it
        clientMap.set(gameIP, [client]);
    };
});

// remove clients which have been inactive for 30 seconds
function removeInactiveClients() {
    const timestamp = Date.now() / 1000;
    clientMap.forEach( (map) => {
        map.forEach( (client, clientIndex) => {
            if (timestamp - client.timestamp > 30) {
                map.splice(clientIndex, 1);
            };
        });
    });
};


// remove entities which are older than 32 ticks
function removeOutdatedEntities() {
    tickCountMap.forEach( (tickCount, gameIP) => {
        // check if entity pool exists 
        if (playerEntitiesMap.has(gameIP)) {
            const playerEntities = playerEntitiesMap.get(gameIP);
            playerEntities.forEach( (entity, mapIndex) => {
                if (tickCount - entity.tickCount > - 32) {
                    playerEntities.splice(mapIndex);
                }
            });
            playerEntitiesMap.set(gameIP, playerEntities);
        } else {
            // if the entity pool does not exist, we will remove the pool from tickCountMap and clientMap
            tickCountMap.delete(gameIP);
            clientMap.delete(gameIP);
        };
    });
};


// dispatch information loop
function dispatchLoop() {
    playerEntitiesMap.forEach( (playerEntities, gameIP) => {
        const temp = [];
        playerEntities.forEach( (playerEntity) => {
            temp.push([playerEntity.index, playerEntity.absOriginX, playerEntity.absOriginY, playerEntity.absOriginZ,
                playerEntity.isDuck, playerEntity.hp, playerEntity.weapon, playerEntity.ammo]);
        });
        const dispatchString = temp.join("|");
        sendInfo(gameIP, dispatchString);
    });
};

// send information
function sendInfo(gameIP, dispatchString) {
    if (clientMap.has(gameIP)) {
        const clientPool = clientMap.get(gameIP);
        clientPool.forEach( (client, index) => {
            socket.send(dispatchString, client.port, client.address);
        });
    };
};

// bind the socket
socket.bind(12345);

// set cron for batch remove inactive clients
setInterval(removeInactiveClients, 5000);
setInterval(removeOutdatedEntities, 200);

// this can be solved better with a setInterval + callback, although I can't be arsed
setInterval(dispatchLoop, 40);