var express = require('express');
var app = express();
var expressWs = require('express-ws')(app);
var os = require('os');
var pty = require('node-pty');
var cors = require('cors');
app.use(cors());
app.options('*', cors());

var terminals = '',
    logs = '';

app.use('/build', express.static(__dirname + '/../build'));

app.get('/', function(req, res){
  res.sendFile(__dirname + '/index.html');
});

app.get('/style.css', function(req, res){
  res.sendFile(__dirname + '/style.css');
});

app.get('/main.js', function(req, res){
  res.sendFile(__dirname + '/main.js');
});

app.ws('/notify', function(ws, req) {
  ws.on('message', function(msg) {
    console.log(msg);
    ws.send(msg);
  });
});

app.ws('/terminals/:pid', function (ws, req) {
  if(terminals[req.params.pid]){
    var term = terminals[req.params.pid];
  }else {
    var term = pty.spawn('ssh', ["-i", "/home/ec2-user/xterm.js/demo/githubdemo.pem", "ec2-user@35.154.96.42"], {
          name: 'xterm-color',
          cwd: process.env.PWD,
          env: process.env
        });

    // FOR LOCAL enable this and commment above 5 line
    // var term = pty.spawn(process.platform === 'win32' ? 'cmd.exe' : 'bash', [], {
    //       name: 'xterm-color',
    //       cwd: process.env.PWD,
    //       env: process.env
    //     });

    terminals[req.params.pid] = term;
    logs[req.params.pid] = '';

    term.on('data', function(data) {
      logs[req.params.pid] += data;
    });
  }

  ws.send(logs[req.params.pid]);

  term.on('data', function(data) {
    try {
      ws.send(data);
    } catch (ex) {
      // The WebSocket is not open, ignore
    }
  });

  ws.on('message', function(msg) {
    term.write(msg);
  });

  ws.on('close', function () {
    process.kill(term.pid);
    delete terminals[req.params.pid];
    delete logs[req.params.pid];
  });

});

console.log('App listening to *:3000');
app.listen(3000);
