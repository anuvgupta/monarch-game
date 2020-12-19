/* GAME */
// web client

var app; app = {
    ui: {
        block: Block('div', 'app'),
        init: (callback) => {
            app.ui.block.fill(document.body);
            Block.queries();
            setTimeout(_ => {
                app.ui.block.css('opacity', '1');
            }, 100);
            setTimeout(_ => {
                Block.queries();
                setTimeout(_ => {
                    Block.queries();
                }, 200);
            }, 50);
            callback();
        },
    },
    ws: {
        id: 0,
        socket: null,
        url:
            (location.protocol === 'https:'
                ? 'wss://'
                : 'ws://') +
            document.domain +
            (document.domain == 'localhost' ? ':30002' : (location.protocol === 'https:' ? ':443' : ':80')) + '/socket',
        encode_msg: (e, d) => {
            return JSON.stringify({
                event: e,
                data: d
            });
        },
        decode_msg: (m) => {
            try {
                m = JSON.parse(m);
            } catch (e) {
                console.log('[ws] invalid json ', e);
                m = null;
            }
            return m;
        },
        connect: callback => {
            var socket = new WebSocket(app.ws.url);
            socket.addEventListener('open', e => {
                console.log('[ws] socket connected');
                callback();
            });
            socket.addEventListener('error', e => {
                console.log('[ws] socket error ', e.data);
            });
            socket.addEventListener('message', e => {
                var d = app.ws.decode_msg(e.data);
                if (d != null) {
                    if (d.event == "update") {
                        console.log('[ws] socket received: game update');
                        var game_data_last = app.main.game_data;
                        app.main.game_data = d.data;
                        app.main.game_update(app.main.game_data, game_data_last);
                    } else {
                        console.log('[ws] socket received:', d.event, d.data);
                        var data = {};
                        data[d.event] = d.data;
                        app.ui.block.data(data);
                    }
                } else console.log('[ws] socket received:', 'invalid message', e.data);
            });
            socket.addEventListener('close', e => {
                console.log('[ws] socket disconnected');
                // alert('disconnected from server');
            });
            window.addEventListener('beforeunload', e => {
                // socket.close(1001);
            });
            app.ws.socket = socket;
        },
        send: (event, data) => {
            console.log('[ws] sending:', event, data);
            app.ws.socket.send(app.ws.encode_msg(event, data));
        },
        api: {
            auth: false,
            login: _ => {
                app.ws.send('auth', true);
            },
            logout: _ => {
                window.location.href = `${window.location.href}`;
                window.location.reload();
            },
            setName: name => {
                app.ws.send('set_name', name);
            },
            requestConfig: _ => {
                app.ws.send('request_config', null);;
            },
            sendMovement: dir => {
                app.ws.send('move_player', dir);
            }
        }
    },
    canvas: {
        element: null,
        context: null,
        data: {
            monarch: new Image(),
            monarchHeight: 1,
            monarchWidth: 1,
            player: new Image(),
            playerR: new Image(),
            playerHeight: 1,
            playerWidth: 1,
            elephant: new Image(),
            elephantHeight: 1,
            elephantWidth: 1,
            groundHeight: 1,
            groundPadding: 1,
            groundColorA: "#000",
            groundColorB: "#000",
            skyColor: "#000",
            elephant_x: 0,
            elephant_y: 0,
            animateElephantInterval: 10,
            notif_timer: 0,
            notif_timer_reset: 4
        },
        init: _ => {
            app.canvas.element = app.ui.block.child("main").on("init").child("canvas").on('init').node();
            app.canvas.context = app.canvas.element.getContext("2d");
            app.canvas.data.monarch.src = "img/monarch.png";
            app.canvas.data.monarch.width = app.canvas.data.monarchWidth;
            app.canvas.data.monarch.height = app.canvas.data.monarchHeight;
            app.canvas.data.player.src = "img/net.png";
            app.canvas.data.player.width = app.canvas.data.playerWidth;
            app.canvas.data.player.height = app.canvas.data.playerHeight;
            app.canvas.data.playerR.src = "img/netR.png";
            app.canvas.data.playerR.width = app.canvas.data.playerWidth;
            app.canvas.data.playerR.height = app.canvas.data.playerHeight;
            app.canvas.data.elephant.src = "img/elephant.png";
            app.canvas.data.elephant.width = app.canvas.data.elephantWidth;
            app.canvas.data.elephant.height = app.canvas.data.elephantHeight;
            window.requestAnimationFrame(app.canvas.draw);
            $("#canvas").focus();
        },
        draw: _ => {
            var ctx = app.canvas.context;
            ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

            // sky
            ctx.fillStyle = app.canvas.data.skyColor;
            ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
            // ground
            ctx.fillStyle = app.canvas.data.groundColorA;
            ctx.fillRect(0, window.innerHeight - app.canvas.data.groundHeight, window.innerWidth, app.canvas.data.groundHeight);
            ctx.fillStyle = app.canvas.data.groundColorB;
            ctx.fillRect(0, window.innerHeight - app.canvas.data.groundHeight, window.innerWidth, 14);
            // butterflies
            app.canvas.drawButterflies(ctx);
            // elephant
            app.canvas.drawElephant(ctx);
            // players
            app.canvas.drawPlayers(ctx);

            window.requestAnimationFrame(app.canvas.draw);
        },
        drawPlayers: ctx => {
            if (app.main.game_running && app.main.game_data) {
                var x = 0;
                var y = 0;
                var new_x = 0;
                var new_y = 0;
                var p_img = null;
                var player = null;
                var zero_loc = [window.innerWidth / 2, window.innerHeight];
                for (var p in app.main.game_data.players) {
                    if (app.main.game_data.players.hasOwnProperty(p)) {
                        p_img = app.canvas.data.player;
                        player = app.main.game_data.players[p];
                        x = player.loc[0] + zero_loc[0];
                        y = (-1 * player.loc[1]) + zero_loc[1];
                        new_x = x - (app.canvas.data.playerWidth / 2);
                        new_y = y - (app.canvas.data.playerHeight + app.canvas.data.groundHeight + app.canvas.data.groundPadding);
                        if (player.loc[0] > player.loc_last[0]) p_img = app.canvas.data.playerR;
                        if (player.invincible) ctx.globalAlpha = 0.65;
                        ctx.drawImage(p_img, new_x, new_y, app.canvas.data.playerWidth, app.canvas.data.playerHeight);
                        ctx.font = "18px Verdana, Trebuchet, Arial, sans-serif";
                        ctx.fillStyle = "rgba(5, 5, 5, 0.8)";
                        ctx.fillText(`${player.name}`, x - (ctx.measureText(player.name).width / 2) + 1 + 1, new_y - 5 - 1);
                        ctx.globalAlpha = 1;
                    }
                }
            }
        },
        drawButterflies: ctx => {
            if (app.main.game_running && app.main.game_data) {
                var x = 0;
                var y = 0;
                var new_x = 0;
                var new_y = 0;
                var b_img = null;
                var butterfly = null;
                var zero_loc = [window.innerWidth / 2, window.innerHeight];
                for (var b in app.main.game_data.butterflies) {
                    if (app.main.game_data.butterflies.hasOwnProperty(b)) {
                        b_img = app.canvas.data.monarch;
                        butterfly = app.main.game_data.butterflies[b];
                        x = butterfly.loc[0] + zero_loc[0];
                        y = (-1 * butterfly.loc[1]) + zero_loc[1];
                        new_x = x - (app.canvas.data.monarchWidth / 2);
                        new_y = y - (app.canvas.data.monarchHeight + app.canvas.data.groundHeight + app.canvas.data.groundPadding);
                        ctx.drawImage(b_img, new_x, new_y, app.canvas.data.monarchWidth, app.canvas.data.monarchHeight);
                    }
                }
            }
        },
        drawElephant: ctx => {
            ctx.drawImage(
                app.canvas.data.elephant,
                (window.innerWidth / 2) - (app.canvas.data.elephantWidth / 2) + 4 + app.canvas.data.elephant_x,
                (-2 * app.canvas.data.elephantHeight / 3) + app.canvas.data.elephant_y,
                app.canvas.data.elephantWidth,
                app.canvas.data.elephantHeight
            );
        },
        animateElephant: _ => {
            var dy = 2;
            var animate = true;
            var animation;
            animation = _ => {
                app.canvas.data.elephant_y += dy;
                if (app.canvas.data.elephant_y >= 130)
                    dy = -2;
                else if (app.canvas.data.elephant_y < 0) {
                    animate = false;
                    app.canvas.data.elephant_y = 0;
                    dy = 0;
                }
                if (animate) setTimeout(animation, app.canvas.data.animateElephantInterval);
            };
            animation();
        }
    },
    main: {
        id: "",
        name: "",
        game_running: false,
        game_data: null,
        game_update: (game_data, game_data_last) => {
            if (app.main.game_running && app.main.game_data) {
                if (app.main.game_data.players.hasOwnProperty(app.main.id)) {
                    app.ui.block.child('main').data({
                        leaderboard: app.main.game_data.leaderboard,
                        score: app.main.game_data.players[app.main.id].score,
                        health: app.main.game_data.players[app.main.id].health
                    });
                    app.ui.block.child('main/leaderboard/board/text').on('update');
                    if (app.canvas.data.notif_timer <= 0) {
                        app.canvas.data.notif_timer = 0;
                        app.ui.block.child("main/notifs").on("clear");
                    } else app.canvas.data.notif_timer -= 1;
                }
            }
        },
        move: dir => {
            if (dir == 'l')
                app.main.move_dir = -1;
            else app.main.move_dir = 1;
        },
        stop: _ => {
            app.main.move_dir = 0;
        },
        move_dir: 0,
        move_interval: 20,
        move_player: _ => {
            if (app.main.game_running) {
                if (app.main.move_dir != 0) {
                    app.ws.api.sendMovement((app.main.move_dir > 0 ? 'r' : 'l'));
                }
            }
            setTimeout(app.main.move_player, app.main.move_interval);
        },
        start_game: _ => {
            app.main.game_running = true;
            setTimeout(app.canvas.init, 200);
            setTimeout(app.main.move_player, 200);
        },
        init: _ => {
            console.clear();
            console.log('[main] loading...');
            setTimeout(_ => {
                app.ui.block.load(_ => {
                    app.ui.block.load(_ => {
                        console.log('[main] blocks loaded');
                        console.log('[main] socket connecting');
                        app.ws.connect(_ => {
                            app.ui.init(_ => {
                                console.log('[main] ready');
                                setTimeout(_ => {
                                    app.ws.api.login();
                                }, 500);
                            });
                        });
                    }, 'app', 'jQuery');
                }, 'blocks', 'jQuery');
            }, 300);
        }
    }
};

$(document).ready(app.main.init);