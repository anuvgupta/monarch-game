/* game.js */

var fs = require('fs');
var ws = require('ws');
var http = require('http');
var path = require('path');
var bp = require('body-parser');
var express = require('express');
var rn = require('random-number');

var util, database, websocket, web, app;

util = {
    delay: (callback, timeout) => {
        setTimeout(_ => {
            process.nextTick(callback);
        }, timeout);
    },
    rand_id: (length = 10) => {
        var key = "";
        var chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
        for (var i = 0; i < length; i++)
            key += chars[util.rand_num(0, chars.length - 1)];
        return key;
    },
    rand_num: (min, max) => {
        return rn({
            min: min,
            max: max,
            integer: true
        });
    },
    rand_float: (min, max) => {
        return rn({
            min: min,
            max: max,
            integer: false
        });
    },
    circleCollide: (loc_1, rad_1, loc_2, rad_2) => {
        var dx = loc_2[0] - loc_1[0];
        var dy = loc_2[1] - loc_1[1];
        var rlim = rad_1 + rad_2;
        return ((dx * dx) + (dy * dy) <= (rlim * rlim));
    },
    bool_to_int: bool => {
        return (bool ? 1 : 0);
    }
};

database = {
    db: {
        players: {},
        butterflies: {}
    },
    getPlayer: client_id => {
        for (var p in database.db.players) {
            if (database.db.players[p].client_id == client_id) {
                return database.db.players[p];
            }
        }
        return null;
    },
    removePlayer: (id) => {
        for (var p in database.db.players) {
            if (database.db.players[p].client_id == id || p == id) {
                delete database.db.players[p];
                return;
            }
        }
    },
    removePlayers: (player_ids) => {
        if (player_ids.length <= 0) return;
        for (var p in player_ids) {
            var id = player_ids[p];
            if (database.db.players.hasOwnProperty(id)) {
                delete database.db.players[id];
            }
        }
    },
    newPlayer: (client_id, name) => {
        var player_id = "_p_" + util.rand_id();
        database.db.players[player_id] = {
            id: player_id,
            client_id: client_id,
            name: name,
            score: 0,
            loc: [0, 0],
            loc_last: [0, 0],
            vloc: [
                app.config.game.playerVelocity[0],
                app.config.game.playerVelocity[1]
            ],
            jump_seq: 0,
            invincible: 0,
            health: 100,
            last_jumper: null,
            dead: false
        };
        return player_id;
    },
    changePlayerPos: (player_id, loc_new) => {
        if (loc_new[0] != database.db.players[player_id].loc[0]) {
            database.db.players[player_id].loc_last[0] = database.db.players[player_id].loc[0];
            database.db.players[player_id].loc[0] = loc_new[0];
        }
        if (loc_new[1] != database.db.players[player_id].loc[1]) {
            database.db.players[player_id].loc_last[1] = database.db.players[player_id].loc[1];
            database.db.players[player_id].loc[1] = loc_new[1];
        }
    },
    removeButterfly: (id) => {
        delete database.db.butterflies[id];
    },
    newButterfly: _ => {
        var butterfly_id = "_b_" + util.rand_id();
        database.db.butterflies[butterfly_id] = {
            id: butterfly_id,
            loc: [
                util.rand_num(-1 * app.config.game.butterflyXGenDistanceLimit, app.config.game.butterflyXGenDistanceLimit),
                util.rand_num(app.config.game.butterflyYGenDistanceLimit - 100, app.config.game.butterflyYGenDistanceLimit + 100)
            ],
            vloc: [util.rand_float(0, 6) - 3, -1 * util.rand_float(1, 2)],
            birthdate: Date.now()
        };
        return butterfly_id;
    },
    deleteButterflies: butterfly_ids => {
        if (butterfly_ids.length <= 0) return;
        for (var b in butterfly_ids) {
            var id = butterfly_ids[b];
            if (database.db.butterflies.hasOwnProperty(id)) {
                delete database.db.butterflies[id];
            }
        }
    }
};

websocket = {
    socket: null,
    online: false,
    clients: {}, // client sockets
    events: {}, // event handlers
    quiet_events: [],
    silent_events: [],
    // encode event+data to JSON
    encode_msg: (e, d) => {
        return JSON.stringify({
            event: e,
            data: d
        });
    },
    // decode event+data from JSON
    decode_msg: (m) => {
        try {
            m = JSON.parse(m);
        } catch (e) {
            console.log("[ws] invalid json msg", e);
            m = null;
        }
        return m;
    },
    // send data to specific authenticated client
    send_to_client: (event, data, client) => {
        client.socket.send(websocket.encode_msg(event, data));
    },
    // send data to specific authenticated client
    trigger_for_client: (event, data, client) => {
        websocket.events[event](client, data, database);
    },
    // send data to specific type of client
    send_to_players: (event, data) => {
        for (var p in database.db.players) {
            if (database.db.players.hasOwnProperty(p)) {
                var client_id = database.db.players[p].client_id;
                websocket.send_to_client(event, data, websocket.clients[client_id]);
            }
        }
    },
    // bind handler to client event
    bind: (event, handler, auth_req = true) => {
        websocket.events[event] = (client, req, db) => {
            if (!auth_req || client.auth)
                handler(client, req, db);
        };
    },
    // initialize & attach events
    run: _ => {
        websocket.socket = new ws.Server({
            port: app.config.ws_port
        });
        // attach server socket events
        websocket.socket.on("connection", (client_socket) => {
            // create client object on new connection
            var client = {
                socket: client_socket,
                id: "_c_" + util.rand_id(),
                auth: false,
                type: "app"
            };
            console.log(`[ws] client ${client.id} – connected`);
            // client socket event handlers
            client.socket.addEventListener("message", (m) => {
                var d = websocket.decode_msg(m.data); // parse message
                if (d != null) {
                    // console.log('    ', d.event, d.data);
                    if (!websocket.quiet_events.includes(d.event)) {
                        if (!websocket.silent_events.includes(d.event))
                            console.log(`[ws] client ${client.id} – message: ${d.event}`, d.data);
                    } else console.log(`[ws] client ${client.id} – message: ${d.event}`);
                    // handle various events
                    if (websocket.events.hasOwnProperty(d.event))
                        websocket.events[d.event](client, d.data, database);
                    else console.log("[ws] unknown event", d.event, d.data);
                } else console.log(`[ws] client ${client.id} – invalid message: `, m.data);
            });
            client.socket.addEventListener("error", (e) => {
                console.log("[ws] client " + client.id + " – error", e);
            });
            client.socket.addEventListener("close", (c, r) => {
                console.log(`[ws] client ${client.id} – disconnected`);
                database.removePlayer(client.id);
                delete websocket.clients[client.id]; // remove client object on disconnect
            });
            // add client object to client object list
            websocket.clients[client.id] = client;
        });
        websocket.socket.on("listening", _ => {
            console.log("[ws] listening on", app.config.ws_port);
            websocket.online = true;
        });
        websocket.socket.on("error", (e) => {
            console.log("[ws] server error", e);
            websocket.online = false;
        });
        websocket.socket.on("close", _ => {
            console.log("[ws] server closed");
            websocket.online = false;
        });

        /* bind events */

        websocket.bind('auth', (client, req, db) => {
            if (req) {
                client.auth = true;
                websocket.send_to_client("auth", true, client);
                console.log(`[ws] client ${client.id} authenticated`);
            } else websocket.send_to_client("auth", false, client);
        }, false);

        websocket.bind('set_name', (client, req, db) => {
            var name = req;
            if (name != null) {
                name = `${name}`;
                var id = db.newPlayer(client.id, name);
                websocket.send_to_client("name", {
                    id: id, name: name
                }, client);
                console.log(`[ws] client ${client.id} set name to ${name}`);
            } else websocket.send_to_client("name", false, client);
        });

        websocket.bind('move_player', (client, req, db) => {
            var dir = req;
            if (dir != null) {
                dir = `${dir}`;
                var p = database.getPlayer(client.id).id;
                if (dir == 'l' || dir == 'r') {
                    app.movePlayer(p, dir);
                } else if (dir == 'j') {
                    app.jumpTrigger(p);
                }
            }
        });
        websocket.silent_events.push('move_player');

        websocket.bind('request_config', (client, req, db) => {
            websocket.send_to_client("config", app.config.game, client);
        });
    }
};

web = {
    app: express(),
    server: null,
    run: _ => {
        web.server = http.Server(web.app);
        web.app.use(bp.json());
        web.app.use(bp.urlencoded({ extended: true }));
        web.app.use((req, res, next) => {
            res.header("Access-Control-Allow-Origin", "*");
            res.header(
                "Access-Control-Allow-Headers",
                "Origin, X-Requested-With, Content-Type, Accept"
            );
            next();
        });
        web.app.use(express.static("html"));
        web.app.get("/", (req, res) => {
            res.sendFile(__dirname + "/html/index.html");
        });
        web.server.listen(app.config.http_port, _ => {
            console.log(`[http] listening on ${app.config.http_port}`);
        });
    }
};

app = {
    config: JSON.parse(fs.readFileSync('./config.json', { encoding: 'utf8', flag: 'r' })),
    movePlayer: (player_id, dir) => {
        if (database.db.players.hasOwnProperty(player_id)) {
            if (dir == 'l') {
                database.changePlayerPos(player_id, [
                    database.db.players[player_id].loc[0] - database.db.players[player_id].vloc[0],
                    database.db.players[player_id].loc[1]
                ]);
            } else if (dir == 'r') {
                database.changePlayerPos(player_id, [
                    database.db.players[player_id].loc[0] + database.db.players[player_id].vloc[0],
                    database.db.players[player_id].loc[1]
                ]);
            }
        }
    },
    collisionLoop: _ => {
        var butterfly_delete_ids = [];
        for (var b in database.db.butterflies) {
            for (var p in database.db.players) {
                if (util.circleCollide(
                    [database.db.players[p].loc[0], database.db.players[p].loc[1] + (app.config.game.playerHeight / 2)],
                    ((app.config.game.playerWidth + app.config.game.playerHeight) / 2) / 2,
                    database.db.butterflies[b].loc,
                    ((app.config.game.monarchWidth + app.config.game.monarchHeight) / 2) / 2
                )) {
                    database.db.players[p].score += 1;
                    butterfly_delete_ids.push(b);
                }
            }
        }
        database.deleteButterflies(butterfly_delete_ids);
        var player_delete_ids = [];
        var cond1, cond2, cond3, cond4, cond4;
        for (var p_i in database.db.players) {
            for (var p_j in database.db.players) {
                if (p_i != p_j) {
                    cond1 = database.db.players[p_i].loc[1] > database.db.players[p_j].loc[1];
                    cond2 = database.db.players[p_i].loc[1] < database.db.players[p_j].loc[1] + (app.config.game.playerHeight);
                    cond3 = database.db.players[p_i].loc[0] > database.db.players[p_j].loc[0] - (app.config.game.playerWidth / 2);
                    cond4 = database.db.players[p_i].loc[0] < database.db.players[p_j].loc[0] + (app.config.game.playerWidth / 2);
                    cond5 = database.db.players[p_i].vloc[1] < 0;
                    cond6 = database.db.players[p_j].invincible == 0;
                    if (cond1 && cond2 && cond3 && cond4 && cond5 && cond6) {
                        database.db.players[p_j].last_jumper = p_i;
                        var steal_amt = Math.round(database.db.players[p_j].score / 4);
                        database.db.players[p_i].score += steal_amt;
                        database.db.players[p_i].vloc[1] = app.config.game.jumpVelocity[1] * 1.2;
                        database.db.players[p_j].score -= steal_amt;
                        if (database.db.players[p_j].score < 0)
                            database.db.players[p_j].score = 0;
                        database.db.players[p_j].health -= app.config.game.jumpHealthCost;
                        if (database.db.players[p_j].health < 0)
                            database.db.players[p_j].health = 0;
                        database.db.players[p_j].invincible = app.config.game.playerInvincibleTime * 1000 / app.gameLoopInterval;
                        websocket.send_to_client("notif", `${database.db.players[p_i].name} stole ${steal_amt} butterflies from you!`, websocket.clients[database.db.players[p_j].client_id]);
                    }
                }
            }
        }
        database.removePlayers(player_delete_ids);
    },
    healthLoop: _ => {
        for (var p in database.db.players) {
            if (database.db.players.hasOwnProperty(p)) {
                if (database.db.players[p].invincible > 0) {
                    database.db.players[p].invincible -= 1;
                }
                if (database.db.players[p].health <= 0 && !database.db.players[p].dead) {
                    database.db.players[p].dead = true;
                    database.db.players[p].health = 0;
                    var last_jumper_id = database.db.players[p].last_jumper;
                    var last_jumper_name = database.db.players[last_jumper_id].name;
                    var client = websocket.clients[database.db.players[p].client_id]
                    setTimeout(_ => {
                        websocket.send_to_client("death", {
                            "last_jumper": {
                                "id": last_jumper_id,
                                "name": last_jumper_name
                            }
                        }, client);
                    }, 500);
                }
            }
        }
    },
    butterflyLoop: _ => {
        var butterfly_delete_ids = [];
        for (var b in database.db.butterflies) {
            if (database.db.butterflies.hasOwnProperty(b)) {
                if (Date.now() - database.db.butterflies[b].birthdate > app.config.game.butterflyLifespan * 1000) {
                    butterfly_delete_ids.push(b);
                }
                if (database.db.butterflies[b].vloc[0] != 0) {
                    database.db.butterflies[b].loc[0] = database.db.butterflies[b].loc[0] + database.db.butterflies[b].vloc[0];
                    if (database.db.butterflies[b].loc[0] < (-1 * app.config.game.butterflyXDistanceLimit) ||
                        database.db.butterflies[b].loc[0] > app.config.game.butterflyXDistanceLimit)
                        database.db.butterflies[b].vloc[0] *= -0.9;
                }
                if (database.db.butterflies[b].vloc[1] != 0) {
                    var y_new = database.db.butterflies[b].loc[1] + database.db.butterflies[b].vloc[1];
                    if (y_new < 0) y_new = 0;
                    database.db.butterflies[b].loc[1] = y_new;
                    if (database.db.butterflies[b].loc[1] <= 0 ||
                        database.db.butterflies[b].loc[1] >= app.config.game.butterflyYDistanceLimit)
                        database.db.butterflies[b].vloc[1] *= -0.9;
                }
            }
        }
        database.deleteButterflies(butterfly_delete_ids);
    },
    jumpLoop: _ => {
        for (var p in database.db.players) {
            if (database.db.players.hasOwnProperty(p)) {
                if (database.db.players[p].vloc[1] != 0) {
                    var y_new = database.db.players[p].loc[1] + database.db.players[p].vloc[1];
                    if (y_new < 0) y_new = 0;
                    database.changePlayerPos(p, [
                        database.db.players[p].loc[0], y_new
                    ]);
                    if (database.db.players[p].loc[1] == 0) {
                        database.db.players[p].vloc[1] = 0;
                        database.db.players[p].jump_seq = 0;
                    } else {
                        database.db.players[p].vloc[1] += app.config.game.gravityVec[1];
                    }
                }
            }
        }
    },
    jumpTrigger: player_id => {
        if (database.db.players.hasOwnProperty(player_id)) {
            if (database.db.players[player_id].jump_seq < app.config.game.jumpLimit) {
                database.db.players[player_id].vloc[1] = app.config.game.jumpVelocity[1] * Math.pow(app.config.game.jumpMultiplier, database.db.players[player_id].jump_seq);
                database.db.players[player_id].jump_seq += 1;
            }
        }
    },
    elephantInterval: 12000,
    elephantIntervalOffset: 2000,
    elephantInterrupt: _ => {
        websocket.send_to_players("elephant", null);
        setTimeout(_ => {
            var num_butterflies = util.rand_num(app.config.game.butterflyGenLowerLimit, app.config.game.butterflyGenUpperLimit);
            for (var i = 0; i < num_butterflies; i++)
                database.newButterfly();
            setTimeout(app.elephantInterrupt, util.rand_num(
                app.elephantInterval - app.elephantIntervalOffset,
                app.elephantInterval + app.elephantIntervalOffset
            ));
        }, 725);
    },
    createLeaderboard: _ => {
        var scores = [];
        for (var p in database.db.players) {
            if (database.db.players.hasOwnProperty(p)) {
                scores.push({
                    id: p,
                    name: database.db.players[p].name,
                    score: database.db.players[p].score,
                    health: database.db.players[p].health
                });
            }
        }
        scores.sort((a, b) => {
            if (a.score > b.score) return 1;
            else if (a.score < b.score) return -1;
            else {
                if (a.health > b.health) return 1;
                else if (a.health < b.health) return -1;
                else return 0;
            }
        });
        var scores_trunc = [];
        for (var i = 0; i < 5; i++) {
            if (i < scores.length)
                scores_trunc.push({
                    id: scores[i].id,
                    name: scores[i].name,
                    score: scores[i].score
                });
        }
        return scores_trunc.reverse();
    },
    sendSummary: _ => {
        var summary = {
            players: {},
            butterflies: {},
            leaderboard: null
        };
        for (var p in database.db.players) {
            if (database.db.players.hasOwnProperty(p)) {
                if (!database.db.players[p].dead || database.db.players[p].health <= 0) {
                    summary.players[p] = {
                        id: database.db.players[p].id,
                        name: database.db.players[p].name,
                        loc: database.db.players[p].loc,
                        loc_last: database.db.players[p].loc_last,
                        score: database.db.players[p].score,
                        health: database.db.players[p].health,
                        invincible: (database.db.players[p].invincible > 0)
                    };
                }
            }
        }
        for (var b in database.db.butterflies) {
            if (database.db.butterflies.hasOwnProperty(b)) {
                summary.butterflies[b] = {
                    id: database.db.butterflies[b].id,
                    loc: database.db.butterflies[b].loc
                };
            }
        }
        summary.leaderboard = app.createLeaderboard();
        websocket.send_to_players("update", summary);
    },
    gameLoopInterval: 10,
    gameLoop: _ => {
        app.jumpLoop();
        app.butterflyLoop();
        app.collisionLoop();
        app.healthLoop();
        app.sendSummary();
        setTimeout(app.gameLoop, app.gameLoopInterval);
    },
    init: _ => {
        setTimeout(app.elephantInterrupt, app.elephantInterval / 2);
        setTimeout(app.gameLoop, app.gameLoopInterval * 2);
    },
    run: _ => {
        app.init();
        websocket.run();
        web.run();
    }
};

app.run();