const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend")));

// Data folder
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const MESSAGES_FILE = path.join(DATA_DIR, "messages.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const FLAGGED_FILE = path.join(DATA_DIR, "flagged.json");

// Helpers to read/write JSON
function readJson(file, defaultVal) {
  try { return JSON.parse(fs.readFileSync(file) || "null") || defaultVal; }
  catch(e){ return defaultVal; }
}
function writeJson(file, data){ fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

let messages = readJson(MESSAGES_FILE, []);
let users = readJson(USERS_FILE, []);
let flagged = readJson(FLAGGED_FILE, []);

// ✅ Message moderation logic
function moderateMessage(message) {
  const bannedWords = [
    "spam", "abuse", "hate", "badword",
    "idiot", "stupid", "dumb", "ugly",
    "nonsense", "fool", "cheat", "annoying",
    "trash", "jerk", "loser", "curse",
    "sex", "xxx", "nude", "porn", "fuck",
    "shit", "bitch", "asshole", "dick",
    "cock", "pussy", "slut", "whore"
  ];

  for (let word of bannedWords) {
    if (message.toLowerCase().includes(word)) {
      return { allowed: false, reason: word };
    }
  }

  // Example: block repeated characters
  if(/([a-zA-Z])\1{6,}/.test(message)) return { allowed:false, reason:"repeated_chars" };

  return { allowed: true };
}

// Simple login
app.post("/api/login", (req,res)=>{
  const { username, role } = req.body;
  if(!username) return res.status(400).json({error:"username required"});
  let user = users.find(u=>u.username===username);
  if(!user){
    user = {id: Date.now()+Math.random(), username, role: role||"user"};
    users.push(user); writeJson(USERS_FILE, users);
  }
  res.json(user);
});

// Flagged moderation API
app.get("/api/flagged", (req,res)=>res.json(flagged));
app.post("/api/flagged/:id/action",(req,res)=>{
  const { action } = req.body;
  const id = req.params.id;
  const idx = flagged.findIndex(f=>String(f.id)===String(id));
  if(idx===-1) return res.status(404).json({error:"flagged not found"});
  const item = flagged[idx];
  if(action==="delete"){ messages = messages.filter(m=>String(m.id)!==String(item.message.id)); flagged.splice(idx,1); }
  else if(action==="ignore"){ flagged.splice(idx,1); messages.push(item.message); }
  else if(action==="ban"){ const u = users.find(u=>u.username===item.message.username); if(u) u.role="banned"; flagged.splice(idx,1); }
  writeJson(MESSAGES_FILE,messages); writeJson(FLAGGED_FILE, flagged); writeJson(USERS_FILE, users);
  io.emit("messages", messages);
  io.emit("flagged", flagged);
  res.json({ok:true});
});

// Socket.io real-time chat
io.on("connection", socket=>{
  socket.emit("messages", messages);
  socket.emit("flagged", flagged);

  socket.on("sendMessage", msg=>{
    const moderation = moderateMessage(msg.text||"");
    const messageObj = { id: Date.now()+Math.random(), username: msg.username, text: msg.text, createdAt: new Date().toISOString() };

    if(!moderation.allowed){
      flagged.push({ id: Date.now()+Math.random(), message: messageObj, reason: moderation.reason });
      writeJson(FLAGGED_FILE, flagged);
      io.emit("flagged", flagged);
      socket.emit("flagged:you", { reason: moderation.reason });
      return;
    }

    messages.push(messageObj); writeJson(MESSAGES_FILE, messages);
    io.emit("messages", messages);
  });
});

// Serve frontend for any route
app.get("*", (req,res)=>res.sendFile(path.join(__dirname, "../frontend/index.html")));

const PORT = process.env.PORT||3000;
server.listen(PORT, ()=>console.log("✅ Chat Web App running on http://localhost:"+PORT));
