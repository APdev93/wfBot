const {
	default: makeWASocket,
	makeCacheableSignalKeyStore,
	PHONENUMBER_MCC,
	useMultiFileAuthState,
	fetchLatestBaileysVersion,
	DisconnectReason,
} = require("@whiskeysockets/baileys");
const NodeCache = require("node-cache");
const readline = require("readline");
const fs = require("fs");
const pino = require("pino");

const { exec } = require("child_process");

const msgRetryCounterCache = new NodeCache();

const useStore = false; // Untuk menyimpan semua data dari bot, contoh: nomer chat grup dll, Atur false saja, karna ini membuat bot berat

const MAIN_LOGGER = pino({
	timestamp: () => `,"time":"${new Date().toJSON()}"`,
});

const logger = MAIN_LOGGER.child({});
logger.level = "trace";

const store = useStore ? makeInMemoryStore({ logger }) : undefined;
store?.readFromFile(`store.json`);

setInterval(
	() => {
		store?.writeToFile(`store.json`);
	},
	1000 * 60 * 24 * 30,
);

/* menggunakan readline sementara */
const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});
const question = text => new Promise(resolve => rl.question(text, resolve));

/* fungsi ini untuk menghilangkan logger dari store */
const P = require("pino")({
	level: "silent",
});

async function startSocket() {
	let { state, saveCreds } = await useMultiFileAuthState("botSession"); // create creds session
	let { version } = await fetchLatestBaileysVersion();
	const sock = makeWASocket({
		version,
		logger: P, // P for hidden log console
		printQRInTerminal: true,
		browser: ["chrome (linux)", "", ""], // If you change this then the pairing code will not work
		auth: {
			creds: state.creds,
			keys: makeCacheableSignalKeyStore(state.keys, P),
		},
		msgRetryCounterCache,
	});
	store?.bind(sock.ev);

	sock.ev.on("creds.update", saveCreds); // to save creds

	if (!sock.authState.creds.registered) {
		const phoneNumber = await question("Enter your active whatsapp number: ");
		const code = await sock.requestPairingCode(phoneNumber);
		console.log(`pairing with this code: ${code}`);
	}

	sock.ev.on("connection.update", async update => {
		const { connection, lastDisconnect } = update;
		/*
		 * pengecekan koneksi
		 */
		if (connection === "connecting") {
			console.log("starting bot socket");
		} else if (connection === "open") {
			console.log("bot socket connected");
		} else if (connection === "close") {
			/* cek apakah koneksi terakhir telah di hapus tapi sessions masih ada, maka session bakal di hapus */
			if (lastDisconnect.error.output.statusCode == DisconnectReason.loggedOut) {
				fs.unlink("botSession", err => {
					if (err) {
						console.log("eror deleting old session");
					} else {
						console.log("delete old session successfully");
					}
				});
				process.exit(0);
			}
			/* Ketika socket terputus maka akan di hubungkan kembali */
			startSocket().catch(() => startSocket());
		}
	});

	sock.ev.on("messages.upsert", async chatUpdate => {
		const m = chatUpdate.messages[0];

		const id = m.key.remoteJid;
		const cek = m.message;

		const fromMe = m.key.fromMe;

		if (m.message?.conversation) {
			var nmsg = m.message.conversation.trim();
		} else if (m.message?.extendedTextMessage) {
			var exmsg = m.message.extendedTextMessage.text.trim();
		} else {
		}
		let cmd = nmsg || exmsg;

		if (cmd === undefined) return;

		function reply(id, msg) {
			sock.sendMessage(id, { text: msg });
		}

		// message command here
		if (cmd) {
			cmd = cmd.toLowerCase();
			const args = cmd.trim().split(/ +/).slice(1);
			console.log(cmd);
		} else {
			console.error("Command is empty.");
		}
		const rootPath = "../";

		/**
		 * execCommandline
		 * @param { string } command
		 */

		function excCmd(command) {
			exec(command, { cwd: rootPath }, (error, stdout, stderr) => {
				if (error) {
					console.error(`Error: ${error.message}`);
					return;
				}
				if (stderr) {
					console.error(`Error: ${stderr}`);
					return;
				}
				console.log(`Output: ${stdout}`);
			});
		}

		switch (cmd) {
			case "/h":
			case "/help":
			case "/menu":
				let menu = `
*ADMIN BOT WFBS*

1. /add
2. /restart
3. /delete

Contoh: Add *id layanan*`;
				reply(id, menu);
				break;

			case "/add":
				{
					let serviceId = args[0];

					if (!serviceId) {
						reply(id, "Service id Tidak boleh kosong\n *Contoh: * ```/add 1```");
					} else {
						await excCmd(
							`npx pm2 start --name @${serviceId} index.js -- ${serviceId}`,
						);
					}
				}
				break;
			case "/restart":
				{
					let serviceId = args[0];

					if (!serviceId) {
						reply(id, "Service id Tidak boleh kosong\n *Contoh: * ```/restart 1```");
					} else {
						await excCmd(`npx pm2 restart @${serviceId}`);
					}
				}
				break;
			case "/delete":
				{
					let serviceId = args[0];

					if (!serviceId) {
						reply(id, "Service id Tidak boleh kosong\n *Contoh: * ```/add 1```");
					} else {
						await excCmd(`npx pm2 delete @${serviceId}`);
					}
				}
				break;

			default:
		}
	});
}
startSocket();
