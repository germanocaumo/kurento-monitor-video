/*
 * (C) Copyright 2014-2015 Kurento (http://kurento.org/)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

var path = require('path');
var url = require('url');
var cookieParser = require('cookie-parser')
var express = require('express');
var session = require('express-session')
var minimist = require('minimist');
var ws = require('ws');
var kurento = require('kurento-client');
var fs = require('fs');
var https = require('https');

var argv = minimist(process.argv.slice(2), {
    default: {
        as_uri: 'https://localhost:8443/',
        //ws_uri: 'ws://196.168.0.197:8888/kurento'
        ws_uri: 'ws://127.0.0.1:8888/kurento'
    }
});

var options =
    {
        key: fs.readFileSync('keys/server.key'),
        cert: fs.readFileSync('keys/server.crt')
    };

var app = express();

/*
 * Management of sessions
 */
app.use(cookieParser());

var sessionHandler = session({
    secret: 'none',
    rolling: true,
    resave: true,
    saveUninitialized: true
});

app.use(sessionHandler);

/*
 * Definition of global variables.
 */
var sessions = {};
var candidatesQueues = {};
var kurentoClient = null;
var serverManager = null;
var pipelines_only = false;
var webRtcEndpoints = [];
var localWebRtcEndpoints = [];
var playerEndpoints = [];
var mediaPipelines = [];

/*
 * Server startup
 */
var asUrl = url.parse(argv.as_uri);
var port = asUrl.port;
var server = https.createServer(options, app).listen(port, function () {
    console.log('Kurento Tutorial started');
    console.log('Open ' + url.format(asUrl) + ' with a WebRTC capable browser');
    getKurentoClient(function (error, kurentoClient) {
        kurentoClient.getServerManager(function (error, server) {
            if (error) {
                onError(error);
            }
            serverManager = server;
        });
    });
});

var wss = new ws.Server({
    server: server,
    path: '/helloworld'
});

/*
 * Management of WebSocket messages
 */
wss.on('connection', function (ws) {
    var sessionId = null;
    var request = ws.upgradeReq;
    var response = {
        writeHead: {}
    };

    sessionHandler(request, response, function (err) {
        sessionId = request.session.id;
        console.log('Connection received with sessionId ' + sessionId);
    });

    ws.on('error', function (error) {
        console.log('Connection ' + sessionId + ' error');
        stop(sessionId);
    });

    ws.on('close', function () {
        console.log('Connection ' + sessionId + ' closed');
        stop(sessionId);
    });

    ws.on('message', function (_message) {
        var message = JSON.parse(_message);
        console.log('Connection ' + sessionId + ' received message ', message);

        switch (message.id) {
            case 'getPipelines':
                sessionId = request.session.id;
                getInfo(serverManager, function (data) {
                    ws.send(JSON.stringify({
                        id: 'getPipelinesResponse',
                        info: webRtcEndpoints
                    }));
                });
                break;

            case 'playVideo':
                sessionId = request.session.id;
                playVideo(sessionId, ws, message.videoId, message.sdpOffer, function (error, sdpAnswer) {
                    if (error) {
                        return ws.send(JSON.stringify({
                            id: 'error',
                            message: error
                        }));
                    }
                    ws.send(JSON.stringify({
                        id: 'playVideoResponse',
                        sdpAnswer: sdpAnswer,
                        videoId: message.videoId
                    }));
                });
                break;

            case 'stop':
                stop(sessionId);
                break;

            case 'onIceCandidate':
                onIceCandidate(sessionId, message.candidate, message.videoId);
                break;

            default:
                ws.send(JSON.stringify({
                    id: 'error',
                    message: 'Invalid message ' + message
                }));
                break;
        }

    });
});

/*
 * Definition of functions
 */

// Recover kurentoClient for the first time.
function getKurentoClient(callback) {
    if (kurentoClient !== null) {
        return callback(null, kurentoClient);
    }

    kurento(argv.ws_uri, function (error, _kurentoClient) {
        if (error) {
            console.log("Could not find media server at address " + argv.ws_uri);
            return callback("Could not find media server at address" + argv.ws_uri
                + ". Exiting with error " + error);
        }

        kurentoClient = _kurentoClient;
        callback(null, kurentoClient);
    });
}

function playVideo(sessionId, ws, videoId, sdpOffer, callback) {
    if (!sessionId) {
        return callback('Cannot use undefined sessionId');
    }

    getKurentoClient(function (error, kurentoClient) {
        if (error) {
            return callback(error);
        }

        //kurentoClient.create('MediaPipeline', function(error, pipeline) {
        //    if (error) {
        //        return callback(error);
        //    }

        createMediaElements(mediaPipelines[videoId], ws, function (error, webRtcEndpoint) {
            if (error) {
                //mediaPipelines[videoId].release();
                return callback(error);
            }

            connectMediaElements(videoId, webRtcEndpoint, function (error) {
                if (error) {
                    //mediaPipelines[videoId].release();
                    return callback(error);
                }

                //var pipelinekey = 'pipeline'+videoId.toString();
                //var webRtcEndpointKey = 'webRtcEndpoint'+videoId.toString();
                localWebRtcEndpoints.push(webRtcEndpoint)
                sessions[sessionId] = {
                    pipelines: mediaPipelines,
                    webRtcEndpoints: localWebRtcEndpoints
                }
                //console.log(sessions)

                webRtcEndpoint.on('MediaFlowInStateChange', function (event) {
                    console.log("MediaFlowInStateChange LOCAL ENDPOINT!!!: " + JSON.stringify(event));
                });

                webRtcEndpoint.on('MediaFlowOutStateChange', function (event) {
                    console.log("MediaFlowOutStateChange LOCAL ENDPOINT!!!: " + JSON.stringify(event));
                });

                webRtcEndpoint.on('OnIceCandidate', function (event) {
                    var candidate = kurento.getComplexType('IceCandidate')(event.candidate);
                    ws.send(JSON.stringify({
                        id: 'iceCandidate',
                        candidate: candidate,
                        videoId: videoId
                    }));
                });

                webRtcEndpoint.processOffer(sdpOffer, function (error, sdpAnswer) {
                    if (error) {
                        //mediaPipelines[videoId].release();
                        return callback(error);
                    }

                    webRtcEndpoint.gatherCandidates(function (error) {
                        if (error) {
                            return callback(error);
                        }

                        if (candidatesQueues[sessionId][videoId]) {
                            while (candidatesQueues[sessionId][videoId].length) {
                                console.log("Unqueuing candidate");
                                var candidate = candidatesQueues[sessionId][videoId].shift();
                                webRtcEndpoint.addIceCandidate(candidate);
                            }
                        }

                        return callback(null, sdpAnswer);
                    });

                });

            });
        });
        //});
    });
}

function createMediaElements(pipeline, ws, callback) {
    pipeline.create('WebRtcEndpoint', function (error, webRtcEndpoint) {
        if (error) {
            return callback(error);
        }

        return callback(null, webRtcEndpoint);
    });
}

function connectMediaElements(videoId, webRtcEndpoint, callback) {
    webRtcEndpoints[videoId].connect(webRtcEndpoint, function (error) {
        if (error) {
            console.log("Error on connect: " + error);
            return callback(error);
        }
        return callback(null);
    });
}

function stop(sessionId) {
    if (sessions[sessionId]) {
        //var pipeline = sessions[sessionId].pipeline;
        //console.info('Releasing pipeline');
        //pipeline.release();
        endpoints = sessions[sessionId].webRtcEndpoints;
        console.log(endpoints);
        for (var i = 0; i < endpoints.length; i++) {
            var endpoint = endpoints[i];
            console.info('Releasing endpoint');
            endpoint.release();
            delete candidatesQueues[sessionId][i];
        }
    }
    delete sessions[sessionId];
    localWebRtcEndpoints = [];
}

function onIceCandidate(sessionId, _candidate, videoId) {
    var candidate = kurento.getComplexType('IceCandidate')(_candidate);

    console.log('VIDEOID: '+ videoId);
    console.log(sessions);
    if (sessions[sessionId] && sessions[sessionId].webRtcEndpoints[videoId]) {
        console.info('Sending candidate');
        console.log(videoId + ': ' + sessions[sessionId].webRtcEndpoints[videoId]);
        var webRtcEndpoint = sessions[sessionId].webRtcEndpoints[videoId];
        webRtcEndpoint.addIceCandidate(candidate);
    }
    else {
        console.info('Queueing candidate');
        //candidatesQueues = candidatesQueues[sessionId];
        if (!candidatesQueues[sessionId]) {
            candidatesQueues[sessionId] = [];
        }
        if (!candidatesQueues[sessionId][videoId]) {
            candidatesQueues[sessionId][videoId] = []
        }
        candidatesQueues[sessionId][videoId].push(candidate);
        //candidatesQueues[videoId].push(candidate);
        console.log(candidatesQueues);
    }
}

app.use(express.static(path.join(__dirname, 'static')));

function getInfo(server, callback) {
    if (!server) {
        return callback('error - failed to find server');
    }

    playerEndpoints = [];
    webRtcEndpoints = [];

    server.getInfo(function (error, serverInfo) {
        if (error) {
            return callback(error);
        }

        getPipelinesInfo(server, function (error, pipelinesInfo) {
            if (error) {
                return callback(error);
            }

            var pipelinesNumber = Object.keys(pipelinesInfo).length;
            if (pipelines_only) {
                return callback(pipelinesNumber);
            } else {
                //add pipeline info to server info
                serverInfo.pipelinesNumber = pipelinesNumber;
                serverInfo.pipelines = pipelinesInfo;
                return callback(JSON.stringify(serverInfo, null, 0));
            }
        });
    })
}

function getPipelinesInfo(server, callback) {
    if (!server) {
        return callback('error - failed to find server');
    }

    var _pipelines = {};
    var names = [];

    server.getPipelines(function (error, pipelines) {
        if (error) {
            return callback(error);
        }

        if (pipelines && (pipelines.length < 1)) {
            return callback(null, _pipelines);
        }

        var childsCounter = 0;
        var mediaFlowingCount = 0;
        var mediaElementsCount = 0;
        mediaPipelines = [];
        //mediaPipelines = pipelines;
        pipelines.forEach(function (p, index, array) {
            //Activate the ability to gather end-to-end latency stats
            p.setLatencyStats(true, function (error) {
                if (error) return onError(error);
            })
            p.getChildren(function (error, elements) {
                //add child elements to pipeline
                this.childs = elements;
                mediaElementsCount = mediaElementsCount + elements.length;
                console.log("mediaElementsCount: " + mediaElementsCount.toString());
                //if (elements.typ)
                //console.log(elements);
                var hasPlayer = elements.length > 1;
                elements.forEach(function (me, index, array) {
                    /*me.isMediaFlowingIn('AUDIO', function (error, result) {
                        console.log("AUDIO isMediaFlowingIn endptoint!!!: " + result);
                        if (result == true) {
                            webRtcEndpoints.push(me);
                            mediaPipelines.push(p);
                            mediaFlowingCount++;
                            if (mediaFlowingCount == mediaElementsCount)
                                return callback(null, _pipelines);
                        } else {
                            me.isMediaFlowingIn('VIDEO', function (error, result) {
                                console.log("VIDEO isMediaFlowingIn endptoint!!!: " + result);
                                if (result == true) {
                                    webRtcEndpoints.push(me);
                                    mediaPipelines.push(p);
                                }
                                mediaFlowingCount++;
                                if (mediaFlowingCount == mediaElementsCount)
                                    return callback(null, _pipelines);
                            });
                        }
                    });*/
                    //console.log(me.id)
                    if (me.id.indexOf("PlayerEndpoint") > -1) {
                        webRtcEndpoints.push(me);
                        me.on('MediaFlowOutStateChange', function (event) {
                            console.log("MediaFlowOutStateChange REMOTE ENDPOINT!!!: " + JSON.stringify(event));
                        });
                        me.on('MediaFlowInStateChange', function (event) {
                            console.log("MediaFlowInStateChange REMOTE ENDPOINT!!!: " + JSON.stringify(event));
                        });
                        mediaPipelines.push(p);
                       me.getName(function(error, name) {
                            names.push(name);
                            console.log(error + ' ' + name);
                       });
                    }
                    if (!hasPlayer && me.id.indexOf("WebRtcEndpoint") > -1) {
                        webRtcEndpoints.push(me);
                        mediaPipelines.push(p);
                        //activateStatsTimeout();
                    }
                    //console.log(me);
                });

                //elements.getChilds(function(error,subelements) { //if (elements.s)
                //  console.log(subelements);
                //});
                //append pipeline+childs to _pipelines
                _pipelines[childsCounter] = this
                childsCounter++;
                if (childsCounter == array.length) {
                    //last child got, return
                    return callback(null, _pipelines);
                }
            })
        })
    })
}

function activateStatsTimeout() {
    setTimeout(function () {
        if (!webRtcEndpoints[0]) return;
        printStats();
        activateStatsTimeout();
    }, 1000);
}

function printStats() {
    getMediaElementStats(webRtcEndpoints[0], 'outboundrtp', 'VIDEO', function (error, stats) {
        if (error)
            return console.log("Warning: could not gather webRtcEndpoing input stats: " + error);

        console.log(stats);
        /*document.getElementById('kmsIncomingSsrc').innerHTML = stats.ssrc;
        document.getElementById('kmsBytesReceived').innerHTML = stats.bytesReceived;
        document.getElementById('kmsPacketsReceived').innerHTML = stats.packetsReceived;
        document.getElementById('kmsPliSent').innerHTML = stats.pliCount;
        document.getElementById('kmsFirSent').innerHTML = stats.firCount;
        document.getElementById('kmsNackSent').innerHTML = stats.nackCount;
        document.getElementById('kmsJitter').innerHTML = stats.jitter;
        document.getElementById('kmsPacketsLost').innerHTML = stats.packetsLost;
        document.getElementById('kmsFractionLost').innerHTML = stats.fractionLost;
        document.getElementById('kmsRembSend').innerHTML = stats.remb;*/
    });

    getMediaElementStats(webRtcEndpoints[0], 'endpoint', 'VIDEO', function (error, stats) {
        if (error) return console.log("Warning: could not gather webRtcEndpoint endpoint stats: " + error);
        console.log(stats);
        //document.getElementById('e2eLatency').innerHTML = stats.videoE2ELatency / 1000000 + " seconds";
    });

};

function getMediaElementStats(mediaElement, statsType, mediaType, callback) {
    if (!mediaElement) return callback('Cannot get stats from null Media Element');
    if (!statsType) return callback('Cannot get stats with undefined statsType')
    if (!mediaType) mediaType = 'VIDEO'; //By default, video
    mediaElement.getStats(mediaType, function (error, statsMap) {
        if (error) return callback(error);
        for (var key in statsMap) {
            if (!statsMap.hasOwnProperty(key)) continue; //do not dig in prototypes properties

            stats = statsMap[key];
            if (stats.type != statsType) continue; //look for the type we want

            return callback(null, stats)
        }
        return callback('Cound not find ' +
            statsType + ':' + mediaType +
            ' stats in element ' + mediaElement.id);
    });
}