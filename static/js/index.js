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

var ws = new WebSocket('wss://' + location.host + '/helloworld');
var videoInput;
var videoOutputsDivs = [];
var videoOutputs = [];
var webRtcPeers = [];
var state = null;
var videosAvailable = 0;

const I_CAN_START = 0;
const I_CAN_STOP = 1;
const I_AM_STARTING = 2;

window.onload = function () {
	console = new Console();
	console.log('Page loaded ...');
	videoInput = document.getElementById('videoInput');
	setState(I_CAN_START);
}

window.onbeforeunload = function () {
	ws.close();
}

ws.onmessage = function (message) {
	var parsedMessage = JSON.parse(message.data);
	console.info('Received message: ' + message.data);

	switch (parsedMessage.id) {
		case 'getPipelinesResponse':
			getPipelinesResponse(parsedMessage);
			break;
		case 'playVideoResponse':
			playVideoResponse(parsedMessage);
			break;
		case 'error':
			if (state == I_AM_STARTING) {
				setState(I_CAN_START);
			}
			onError('Error message from server: ' + parsedMessage.message);
			break;
		case 'iceCandidate':
			webRtcPeers[parsedMessage.videoId].addIceCandidate(parsedMessage.candidate);
			break;
		default:
			if (state == I_AM_STARTING) {
				setState(I_CAN_START);
			}
			onError('Unrecognized message', parsedMessage);
	}
}

function start() {
	console.log('Starting getPipelines call ...')

	for (var i = 0; i < videosAvailable; i++) {
		removeElement('videoOutputDiv' + i);
	}
	videosAvailable = 0;

	// Disable start button
	//setState(I_AM_STARTING);
	//showSpinner(videoInput, videoOutput);

	var message = {
		id: 'getPipelines',
	}

	sendMessage(message);
}

function playVideo() {
	console.log('Starting playVideo call ...')

	// Disable start button
	setState(I_AM_STARTING);
	//showSpinner(videoInput, videoOutput);

	var userMediaConstraints = {
		audio: true,
		video: true
	};

	for (var i = 0; i < videosAvailable; i++) {
		var options = {
			remoteVideo: videoOutputs[i],
			mediaConstraints: userMediaConstraints,
			onicecandidate: onIceCandidate
		}

		webRtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerRecvonly(options, function (error) {
			if (error) return onError(error);
			this.videoId = webRtcPeers.length;
			webRtcPeers.push(this)
			console.log('Setting video id webrtcpeer: ' + (this.videoId).toString());
			//console.log(webRtcPeers);
			this.generateOffer(onOffer);
		});
	}
}

function onIceCandidate(candidate) {
	console.log('Local candidate' + JSON.stringify(candidate));
	console.log("VIDEOID: " + this.videoId)
	var message = {
		id: 'onIceCandidate',
		candidate: candidate,
		videoId: this.videoId
	};
	sendMessage(message);
}

function onOffer(error, offerSdp) {
	if (error) return onError(error);
	console.info('Invoking SDP offer callback function ' + location.host);

	var message = {
		id: 'playVideo',
		videoId:  this.videoId,
		sdpOffer: offerSdp
	}
	sendMessage(message);
}

function onError(error) {
	console.error(error);
}

function playVideoResponse(message) {
	setState(I_CAN_STOP);
	console.log('SDP answer received from server. Processing ...');
	webRtcPeers[message.videoId].processAnswer(message.sdpAnswer);
	//activateStatsTimeout();
}

function getPipelinesResponse(message) {
	//setState(I_CAN_STOP);
	console.log(message.info);
	document.getElementById('pipelines').innerHTML = message.info.length;
	videosAvailable = message.info.length;
	videoOutputsDivs = [];
	videoOutputs = [];


	for (var i = 0; i < videosAvailable; i++) {
		var videoOutputId = 'videoOutput' + i;
		var html =
			'<div class="col-md-5">' +
			'<video id="' + videoOutputId + '" autoplay width="480px" height="360px" poster="img/webrtc.png"></video>' +
			' </div>'

		addElement('videos', 'div', 'videoOutputDiv' + i, html);
		videoOutputsDivs.push(document.getElementById('videoOutputDiv' + i));
		videoOutputs.push(document.getElementById('videoOutput' + i));
		console.log(videoOutputs);
	}
}

function stop() {
	console.log('Stopping video call ...');
	setState(I_CAN_START);
	for (var i = 0; i < webRtcPeers.length; i++) {
		if (webRtcPeers[i]) {
			console.log('Stopping video '+i);
			webRtcPeers[i].dispose();
			webRtcPeers[i] = null;

			var message = {
				id: 'stop'
			}
			sendMessage(message);
		}
	}
	webRtcPeers = [];
	//hideSpinner(videoInput, videoOutput);
}

function setState(nextState) {
	switch (nextState) {
		case I_CAN_START:
			$('#getpipelines').attr('disabled', false);
			$('#getpipelines').attr('onclick', 'start()');
			$('#play').attr('disabled', false);
			$('#play').attr('onclick', 'playVideo()');
			$('#stop').attr('disabled', true);
			$('#stop').removeAttr('onclick');
			break;

		case I_CAN_STOP:
			$('#start').attr('disabled', true);
			$('#stop').attr('disabled', false);
			$('#stop').attr('onclick', 'stop()');
			break;

		case I_AM_STARTING:
			$('#start').attr('disabled', true);
			$('#start').removeAttr('onclick');
			$('#stop').attr('disabled', true);
			$('#stop').removeAttr('onclick');
			break;

		default:
			onError('Unknown state ' + nextState);
			return;
	}
	state = nextState;
}

function sendMessage(message) {
	var jsonMessage = JSON.stringify(message);
	console.log('Senging message: ' + jsonMessage);
	ws.send(jsonMessage);
}

function showSpinner() {
	for (var i = 0; i < arguments.length; i++) {
		arguments[i].poster = './img/transparent-1px.png';
		arguments[i].style.background = 'center transparent url("./img/spinner.gif") no-repeat';
	}
}

function hideSpinner() {
	for (var i = 0; i < arguments.length; i++) {
		arguments[i].src = '';
		arguments[i].poster = './img/webrtc.png';
		arguments[i].style.background = '';
	}
}

/**
 * Lightbox utility (to display media pipeline image in a modal dialog)
 */
$(document).delegate('*[data-toggle="lightbox"]', 'click', function (event) {
	event.preventDefault();
	$(this).ekkoLightbox();
});

function activateStatsTimeout() {
	setTimeout(function () {
		if (!webRtcPeers) return;
		printStats();
		activateStatsTimeout();
	}, 1000);
}

function printStats() {
	listStats(webRtcPeers[0].peerConnection);
}

//Aux function used for printing stats associated to a track.
function listStats(peerConnection) {
	var remoteVideoTrack = peerConnection.getRemoteStreams()[0].getVideoTracks()[0];

	peerConnection.getStats(function (stats) {
		var results = stats.result();

		for (var i = 0; i < results.length; i++) {
			console.log("Iterating i=" + i);
			var res = results[i];
			console.log("res.type=" + res.type);
			var names = res.names();

			for (var j = 0; j < names.length; j++) {
				var name = names[j];
				var stat = res.stat(name);
				console.log("For name " + name + " stat is " + stat);
				if (name.indexOf("googFrameRateDecoded") > -1) {
					document.getElementById('stats').innerHTML = stat;
				}
			}
		}
	}, remoteVideoTrack);
}

function addElement(parentId, elementTag, elementId, html) {
	// Adds an element to the document
	var p = document.getElementById(parentId);
	var newElement = document.createElement(elementTag);
	newElement.setAttribute('id', elementId);
	newElement.innerHTML = html;
	p.appendChild(newElement);
}

function removeElement(elementId) {
	// Removes an element from the document
	var element = document.getElementById(elementId);
	element.parentNode.removeChild(element);
}