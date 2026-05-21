const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

app.get('/host', (req, res) => res.sendFile(path.join(__dirname, 'public/host/index.html')));
app.get('/play', (req, res) => res.sendFile(path.join(__dirname, 'public/player/index.html')));

const QUESTIONS = [
  {
    acte: 1, acteName: "Acte 1 — Histoire de la Pizza DAO",
    type: "quiz", time: 20,
    text: "Quelle est la date du tout premier achat avec du Bitcoin dans l'histoire ?",
    opts: ["Le 3 janvier 2009", "Le 22 mai 2010", "Le 31 octobre 2008"],
    correct: 1,
    expl: "Le 22 mai 2010, Laszlo Hanyecz a payé 10 000 BTC pour deux pizzas. C'est le Bitcoin Pizza Day !"
  },
  {
    acte: 1,
    type: "quiz", time: 20,
    text: "Combien de Bitcoins Laszlo Hanyecz a-t-il payés pour ses deux pizzas ?",
    opts: ["1 000 BTC", "10 000 BTC", "50 000 BTC"],
    correct: 1,
    expl: "10 000 BTC, achetés à 'jercos' sur BitcoinTalk. Première transaction crypto pour un bien physique."
  },
  {
    acte: 1,
    type: "quiz", time: 20,
    text: "Qu'est-ce qu'une DAO (Decentralized Autonomous Organization) ?",
    opts: ["Une banque numérique centralisée", "Un jeu vidéo sur blockchain", "Une organisation gérée par ses membres via des règles sur blockchain"],
    correct: 2,
    expl: "Une DAO est une communauté auto-organisée où les décisions se prennent par vote collectif, sans patron ni bureau central."
  },
  {
    acte: 1,
    type: "game",
    gameTitle: "Jeu rapide — Le prix des pizzas",
    gameDesc: "L'animateur annonce le cours actuel du BTC. Qui calcule le plus vite combien valent aujourd'hui ces 10 000 BTC ? Premier à crier le bon ordre de grandeur gagne un point bonus !"
  },
  {
    acte: 2, acteName: "Acte 2 — Wallets & Sécurité",
    type: "quiz", time: 20,
    text: "Quels sont les deux grands types de wallets crypto ?",
    opts: ["Wallet chaud et wallet froid", "Wallet custodial et non custodial", "Les deux réponses sont correctes"],
    correct: 2,
    expl: "On classe les wallets par température (chaud/froid) ou par garde (custodial/non custodial). Les deux sont valides !"
  },
  {
    acte: 2,
    type: "quiz", time: 20,
    text: "Qu'est-ce qui définit un wallet 'non custodial' ?",
    opts: ["La plateforme conserve tes clés privées", "Toi seul détiens ta clé privée et ta seed phrase", "Un wallet qui ne stocke qu'un seul type de crypto"],
    correct: 1,
    expl: "Avec MetaMask ou Trust Wallet, tu es seul responsable de ta seed phrase. Liberté totale, responsabilité totale."
  },
  {
    acte: 2,
    type: "vf", time: 15,
    text: "Vrai ou Faux ? Stocker sa seed phrase dans une note sur son téléphone est une bonne pratique de sécurité.",
    opts: ["Vrai — le téléphone est toujours avec soi", "Faux — le téléphone peut être hacké ou perdu"],
    correct: 1,
    expl: "FAUX. Note ta seed phrase sur papier, hors ligne. Jamais dans le cloud ou une note numérique."
  },
  {
    acte: 3, acteName: "Acte 3 — L'Afrique & le Web3",
    type: "quiz", time: 20,
    text: "Pourquoi l'Afrique est-elle considérée comme un marché stratégique pour le Web3 ?",
    opts: ["Les grandes entreprises Web3 sont africaines", "Forte jeunesse mobile-first et accès limité aux banques", "L'Afrique est le plus grand marché de mining"],
    correct: 1,
    expl: "60% des Africains ont moins de 25 ans. Des millions n'ont pas de compte bancaire mais ont un smartphone."
  },
  {
    acte: 3,
    type: "quiz", time: 20,
    text: "Quel est l'un des principaux défis pour l'adoption du Web3 en Afrique ?",
    opts: ["Manque d'infra internet stable et barrière technique", "Absence totale d'utilisateurs crypto sur le continent", "Toutes les blockchains sont interdites en Afrique"],
    correct: 0,
    expl: "Accès internet inégal, électricité instable, interfaces en anglais, complexité technique. Des communautés comme celle d'Abidjan travaillent à changer ça !"
  },
  {
    acte: 3,
    type: "game",
    gameTitle: "Débat flash — 2 minutes",
    gameDesc: "Si tu pouvais créer une solution Web3 pour résoudre un problème du quotidien en Côte d'Ivoire, ce serait quoi ? Chaque participant a 20 secondes. Le public vote pour la plus originale !"
  }
];

const state = {
  phase: 'lobby',
  players: {},
  currentQ: -1,
  timer: null,
  timeLeft: 0,
  answered: new Set(),
  scores: {}
};

let hostWs = null;
const playerSockets = {};

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

function sendHost(data) {
  if (hostWs && hostWs.readyState === WebSocket.OPEN) hostWs.send(JSON.stringify(data));
}

function sendPlayer(id, data) {
  const ws = playerSockets[id];
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

function startTimer(seconds) {
  state.timeLeft = seconds;
  sendHost({ type: 'timer', value: seconds, max: seconds });
  state.timer = setInterval(() => {
    state.timeLeft--;
    sendHost({ type: 'timer', value: state.timeLeft, max: seconds });
    Object.keys(playerSockets).forEach(id => sendPlayer(id, { type: 'timer', value: state.timeLeft, max: seconds }));
    if (state.timeLeft <= 0) {
      clearInterval(state.timer);
      revealAnswer();
    }
  }, 1000);
}

function stopTimer() {
  if (state.timer) { clearInterval(state.timer); state.timer = null; }
}

function revealAnswer() {
  stopTimer();
  const q = QUESTIONS[state.currentQ];
  if (q.type === 'game') return;
  state.phase = 'reveal';
  sendHost({ type: 'reveal', correct: q.correct, expl: q.expl });
  Object.keys(playerSockets).forEach(id => {
    sendPlayer(id, { type: 'reveal', correct: q.correct, score: state.scores[id] || 0 });
  });
}

function getLeaderboard() {
  return Object.entries(state.scores)
    .map(([id, pts]) => ({ name: state.players[id]?.name || id, pts }))
    .sort((a, b) => b.pts - a.pts)
    .slice(0, 10);
}

wss.on('connection', (ws) => {
  let playerId = null;
  let isHost = false;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'host-connect') {
      isHost = true;
      hostWs = ws;
      ws.send(JSON.stringify({
        type: 'host-state',
        phase: state.phase,
        players: Object.values(state.players),
        scores: getLeaderboard(),
        questionIndex: state.currentQ,
        totalQ: QUESTIONS.length
      }));
      return;
    }

    if (msg.type === 'join') {
      playerId = 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      playerSockets[playerId] = ws;
      state.players[playerId] = { id: playerId, name: msg.name };
      state.scores[playerId] = 0;
      sendHost({ type: 'player-joined', players: Object.values(state.players) });
      ws.send(JSON.stringify({ type: 'joined', id: playerId, name: msg.name, phase: state.phase }));
      return;
    }

    if (msg.type === 'next' && isHost) {
      stopTimer();
      state.answered.clear();
      state.currentQ++;
      if (state.currentQ >= QUESTIONS.length) {
        state.phase = 'end';
        const lb = getLeaderboard();
        broadcast({ type: 'end', leaderboard: lb });
        return;
      }
      const q = QUESTIONS[state.currentQ];
      state.phase = q.type === 'game' ? 'game' : 'question';
      if (q.type === 'game') {
        broadcast({ type: 'game-slide', acteName: q.acteName, gameTitle: q.gameTitle, gameDesc: q.gameDesc });
      } else {
        const qData = {
          type: 'question',
          index: state.currentQ,
          acte: q.acte,
          acteName: q.acteName,
          qType: q.type,
          text: q.text,
          opts: q.opts,
          time: q.time,
          totalQ: QUESTIONS.filter(x => x.type !== 'game').length
        };
        broadcast(qData);
        startTimer(q.time);
      }
      return;
    }

    if (msg.type === 'answer' && playerId) {
      if (state.phase !== 'question') return;
      if (state.answered.has(playerId)) return;
      state.answered.add(playerId);
      const q = QUESTIONS[state.currentQ];
      const isCorrect = msg.choice === q.correct;
      const bonus = isCorrect ? Math.round(1000 * (state.timeLeft / q.time) + 100) : 0;
      state.scores[playerId] = (state.scores[playerId] || 0) + bonus;
      sendPlayer(playerId, { type: 'answer-ack', correct: isCorrect, bonus, score: state.scores[playerId] });
      sendHost({ type: 'answer-in', count: state.answered.size, total: Object.keys(state.players).length });
      if (state.answered.size >= Object.keys(state.players).length) revealAnswer();
      return;
    }

    if (msg.type === 'bonus' && isHost) {
      const target = Object.keys(state.players).find(id => state.players[id].name === msg.name);
      if (target) {
        state.scores[target] = (state.scores[target] || 0) + 500;
        sendHost({ type: 'leaderboard', leaderboard: getLeaderboard() });
        sendPlayer(target, { type: 'bonus', score: state.scores[target] });
      }
      return;
    }

    if (msg.type === 'reset' && isHost) {
      stopTimer();
      state.phase = 'lobby';
      state.currentQ = -1;
      state.answered.clear();
      Object.keys(state.players).forEach(id => { state.scores[id] = 0; });
      broadcast({ type: 'reset' });
      sendHost({ type: 'host-state', phase: 'lobby', players: Object.values(state.players), scores: [], questionIndex: -1, totalQ: QUESTIONS.length });
      return;
    }
  });

  ws.on('close', () => {
    if (playerId && playerSockets[playerId]) {
      delete playerSockets[playerId];
      delete state.players[playerId];
      sendHost({ type: 'player-left', players: Object.values(state.players) });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Pizza DAO Quiz running on port ${PORT}`));
