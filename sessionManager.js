const axios = require('axios');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const net = require('net');
const protobuf = require('protobufjs');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

function encryptPacket(plainText, key, iv) {
    if (typeof plainText === 'string') plainText = Buffer.from(plainText, 'hex');
    if (typeof key === 'string') key = Buffer.from(key, 'hex');
    if (typeof iv === 'string') iv = Buffer.from(iv, 'hex');
    const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
    cipher.setAutoPadding(true);
    return Buffer.concat([cipher.update(plainText), cipher.final()]).toString('hex');
}

function decryptPacket(cipherText, key, iv) {
    if (typeof cipherText === 'string') cipherText = Buffer.from(cipherText, 'hex');
    if (typeof key === 'string') key = Buffer.from(key, 'hex');
    if (typeof iv === 'string') iv = Buffer.from(iv, 'hex');
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    decipher.setAutoPadding(true);
    return Buffer.concat([decipher.update(cipherText), decipher.final()]);
}

function encryptedProto(encodedBytes) {
    const key = Buffer.from('Yg&tc%DEuh6%Zc^8', 'utf-8');
    const iv = Buffer.from('6oyZDr22E3ychjM%', 'utf-8');
    const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
    cipher.setAutoPadding(true);
    return Buffer.concat([cipher.update(encodedBytes), cipher.final()]);
}

async function decryptMajorLoginRes(response, MajorLoginRes) {
    const key = Buffer.from('Yg&tc%DEuh6%Zc^8', 'utf-8');
    const iv = Buffer.from('6oyZDr22E3ychjM%', 'utf-8');
    try {
        const responseText = response.toString('utf-8');
        if (responseText.startsWith('{')) {
            const errorJson = JSON.parse(responseText);
            throw new Error(`${errorJson.type || 'error'} - ${errorJson.msg || ''}`);
        }
    } catch (e) {
        if (e.message.includes(' - ')) throw e;
    }
    try {
        return MajorLoginRes.decode(response);
    } catch (e) {}
    if (response.length % 16 === 0) {
        return MajorLoginRes.decode(decryptPacket(response, key, iv));
    }
    throw new Error('Invalid response');
}

function createTCPSocket() {
    const sock = new net.Socket();
    sock.setKeepAlive(true, 10000);
    sock.setTimeout(0);
    sock.setNoDelay(true);
    return sock;
}

function parseProtobufResponse(buffer) {
    const result = {};
    let offset = 0;
    function readVarint() {
        let value = 0, shift = 0;
        while (offset < buffer.length) {
            const byte = buffer[offset++];
            value |= (byte & 0x7F) << shift;
            if ((byte & 0x80) === 0) break;
            shift += 7;
        }
        return value;
    }
    while (offset < buffer.length) {
        const tag = buffer[offset++];
        const fieldNumber = tag >> 3;
        const wireType = tag & 0x07;
        if (wireType === 0) result[fieldNumber] = readVarint();
        else if (wireType === 1) offset += 8;
        else if (wireType === 2) {
            const length = readVarint();
            if (offset + length <= buffer.length) {
                result[fieldNumber] = buffer.slice(offset, offset + length).toString('utf-8');
                offset += length;
            } else break;
        } else if (wireType === 5) offset += 4;
        else break;
    }
    return result;
}

class SessionManager {
    constructor(sessionName, accessToken, onLog, onStatusChange) {
        this.sessionName = sessionName;
        this.accessToken = accessToken;
        this.onLog = onLog || (() => {});
        this.onStatusChange = onStatusChange || (() => {});
        this.status = 'idle';
        this.tcpClients = { whisper: null, online: null };
        this.pendingClients = { whisper: null, online: null };
        this.heartbeatInterval = null;
        this.connectionCheckInterval = null;
        this.preemptiveReconnectInterval = null;
        this.accountId = null;
        this.isStopped = false;
        this.reconnectTimeout = null;
        this.connectionData = null;
        this.lastDataTime = Date.now();
        this.isReconnecting = false;
        this.isPreparing = false;
        this.firstConnect = true;
        this.lastError = '';
    }

    log(message, type = 'info') {
        this.onLog(this.sessionName, message, type);
    }

    setStatus(status) {
        this.status = status;
        this.onStatusChange(this.sessionName, status);
    }

    async prepareSession() {
        const accessUrl = `https://100067.connect.garena.com/oauth/token/inspect?token=${this.accessToken}`;
        let tokenData;
        try {
            const r = await axios.get(accessUrl, { timeout: 10000 });
            tokenData = { openId: r.data.open_id, mainPlatform: r.data.platform, platform: r.data.login_platform };
        } catch (e) {
            throw new Error('Token invalid');
        }

        const root = await protobuf.load(['MajorLoginReq.proto', 'MajorLoginRes.proto']);
        const MajorLogin = root.lookupType('MajorLogin');
        const MajorLoginRes = root.lookupType('MajorLoginRes');

        const headers = {
            'Accept-Encoding': 'gzip',
            'Authorization': 'Bearer',
            'Connection': 'Keep-Alive',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Expect': '100-continue',
            'Host': 'loginbp.ggwhitehawk.com',
            'ReleaseVersion': 'OB51',
            'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 9; G011A Build/PI)',
            'X-GA': 'v1 1',
            'X-Unity-Version': '2018.4.11f1'
        };

        const majorLoginData = {
            eventTime: new Date().toISOString().slice(0, 19).replace('T', ' '),
            gameName: 'free fire',
            platformId: 1,
            clientVersion: '1.118.1',
            systemSoftware: 'Android OS 9 / API-28 (PQ3B.190801.10101846/G9650ZHU2ARC6)',
            systemHardware: 'Handheld',
            telecomOperator: 'Verizon',
            networkType: 'WIFI',
            screenWidth: 1920,
            screenHeight: 1080,
            screenDpi: '280',
            processorDetails: 'ARM64 FP ASIMD AES VMH | 2865 | 4',
            memory: 3003,
            gpuRenderer: 'Adreno (TM) 640',
            gpuVersion: 'OpenGL ES 3.1 v1.46',
            uniqueDeviceId: 'Google|34a7dcdf-a7d5-4cb6-8d7e-3b0e448a0c57',
            clientIp: '223.191.51.89',
            language: 'en',
            openId: tokenData.openId,
            openIdType: `${tokenData.platform}`,
            deviceType: 'Handheld',
            memoryAvailable: { version: 55, hiddenValue: 81 },
            accessToken: this.accessToken,
            platformSdkId: 1,
            networkOperatorA: 'Verizon',
            networkTypeA: 'WIFI',
            clientUsingVersion: '7428b253defc164018c604a1ebbfebdf',
            externalStorageTotal: 36235,
            externalStorageAvailable: 31335,
            internalStorageTotal: 2519,
            internalStorageAvailable: 703,
            gameDiskStorageAvailable: 25010,
            gameDiskStorageTotal: 26628,
            externalSdcardAvailStorage: 32992,
            externalSdcardTotalStorage: 36235,
            loginBy: 3,
            libraryPath: '/data/app/com.dts.freefireth-YPKM8jHEwAJlhpmhDhv5MQ==/lib/arm64',
            regAvatar: 1,
            libraryToken: '5b892aaabd688e571f688053118a162b|/data/app/com.dts.freefireth-YPKM8jHEwAJlhpmhDhv5MQ==/base.apk',
            channelType: 3,
            cpuType: 2,
            cpuArchitecture: '64',
            clientVersionCode: '2019118695',
            graphicsApi: 'OpenGLES2',
            supportedAstcBitset: 16383,
            loginOpenIdType: String(tokenData.platform),
            analyticsDetail: Buffer.from('FwQVTgUPX1UaUllDDwcWCRBpWAUOUgsvA1snWlBaO1kFYg==', 'base64'),
            loadingTime: 13564,
            releaseChannel: 'android',
            extraInfo: 'KqsHTymw5/5GB23YGniUYN2/q47GATrq7eFeRatf0NkwLKEMQ0PK5BKEk72dPflAxUlEBir6Vtey83XqF593qsl8hwY=',
            androidEngineInitFlag: 110009,
            ifPush: 1,
            isVpn: 1,
            originPlatformType: `${tokenData.mainPlatform}`,
            primaryPlatformType: `${tokenData.mainPlatform}`
        };

        const buffer = MajorLogin.encode(MajorLogin.create(majorLoginData)).finish();
        const encryptedData = encryptedProto(buffer);

        const response = await axios.post('https://loginbp.ggwhitehawk.com/MajorLogin', encryptedData, { headers, responseType: 'arraybuffer', timeout: 15000 });
        const majorLoginAuth = await decryptMajorLoginRes(Buffer.from(response.data), MajorLoginRes);

        const token = majorLoginAuth.token;
        const urlL = majorLoginAuth.url;
        const ak = majorLoginAuth.key.toString('hex');
        const aiv = majorLoginAuth.iv.toString('hex');
        const ktsTimestamp = majorLoginAuth.timestamp;
        const host = urlL.split('//')[1];

        const getLoginHeaders = { ...headers, 'Authorization': `Bearer ${token}`, 'Host': host };
        const loginResponse = await axios.post(`${urlL}/GetLoginData`, encryptedData, { headers: getLoginHeaders, responseType: 'arraybuffer', timeout: 15000 });
        const parsedData = parseProtobufResponse(Buffer.from(loginResponse.data));

        const onlineAddress = parsedData['14'];
        const whisperAddress = parsedData['32'] || onlineAddress;
        if (!onlineAddress) throw new Error('No server address');

        const decoded = jwt.decode(token);
        const accountId = BigInt(decoded.account_id);
        this.accountId = accountId.toString();
        const encodedAcc = accountId.toString(16);

        const ktsTimestampBig = BigInt(ktsTimestamp.toString());
        const combinedTimestamp = (ktsTimestampBig / BigInt(1000000000)) * BigInt(1000000000) + (ktsTimestampBig % BigInt(1000000000));
        const timeHex = combinedTimestamp.toString(16);
        const base64Token = Buffer.from(token, 'utf-8').toString('hex');

        let head = (encryptPacket(base64Token, ak, aiv).length / 2).toString(16);
        const length = encodedAcc.length;
        let zeros = length === 9 ? '0000000' : length === 10 ? '000000' : length === 7 ? '000000000' : '00000000';
        head = `0115${zeros}${encodedAcc}${timeHex}00000${head}`;
        const finalToken = head + encryptPacket(base64Token, ak, aiv);

        return {
            finalToken,
            whisperIp: whisperAddress.slice(0, -6),
            whisperPort: parseInt(whisperAddress.slice(-5)),
            onlineIp: onlineAddress.slice(0, -6),
            onlinePort: parseInt(onlineAddress.slice(-5))
        };
    }

    cleanupConnections() {
        if (this.heartbeatInterval) { clearInterval(this.heartbeatInterval); this.heartbeatInterval = null; }
        if (this.connectionCheckInterval) { clearInterval(this.connectionCheckInterval); this.connectionCheckInterval = null; }
        if (this.preemptiveReconnectInterval) { clearInterval(this.preemptiveReconnectInterval); this.preemptiveReconnectInterval = null; }
        if (this.tcpClients.whisper) { try { this.tcpClients.whisper.removeAllListeners(); this.tcpClients.whisper.destroy(); } catch (e) {} this.tcpClients.whisper = null; }
        if (this.tcpClients.online) { try { this.tcpClients.online.removeAllListeners(); this.tcpClients.online.destroy(); } catch (e) {} this.tcpClients.online = null; }
        if (this.pendingClients.whisper) { try { this.pendingClients.whisper.removeAllListeners(); this.pendingClients.whisper.destroy(); } catch (e) {} this.pendingClients.whisper = null; }
        if (this.pendingClients.online) { try { this.pendingClients.online.removeAllListeners(); this.pendingClients.online.destroy(); } catch (e) {} this.pendingClients.online = null; }
    }

    async connectSockets() {
        if (this.isStopped) return;
        this.isReconnecting = false;
        this.cleanupConnections();

        try {
            this.connectionData = await this.prepareSession();
            this.lastError = '';
        } catch (e) {
            if (this.lastError !== e.message) {
                this.log(`${e.message}`, 'error');
                this.lastError = e.message;
            }
            this.scheduleReconnect();
            return;
        }

        const { finalToken, whisperIp, whisperPort, onlineIp, onlinePort } = this.connectionData;
        this.lastDataTime = Date.now();

        this.tcpClients.whisper = createTCPSocket();
        this.tcpClients.online = createTCPSocket();

        this.tcpClients.whisper.connect(whisperPort, whisperIp, () => { this.tcpClients.whisper.write(Buffer.from(finalToken, 'hex')); });
        this.tcpClients.online.connect(onlinePort, onlineIp, () => { this.tcpClients.online.write(Buffer.from(finalToken, 'hex')); });

        this.tcpClients.whisper.on('data', () => { this.lastDataTime = Date.now(); });
        this.tcpClients.whisper.on('close', () => { this.handleDisconnect(); });
        this.tcpClients.whisper.on('error', () => { this.handleDisconnect(); });

        this.tcpClients.online.on('data', () => { this.lastDataTime = Date.now(); });
        this.tcpClients.online.on('close', () => { this.handleDisconnect(); });
        this.tcpClients.online.on('error', () => { this.handleDisconnect(); });

        if (!this.isStopped) {
            if (this.firstConnect) {
                this.log(`متصل - ${this.accountId}`, 'success');
                this.firstConnect = false;
            }
            this.setStatus('running');
            this.startHeartbeat();
            this.startConnectionCheck();
            this.startPreemptiveReconnect();
        }
    }

    async prepareNextSession() {
        if (this.isStopped || this.isPreparing) return;
        this.isPreparing = true;
        
        try {
            const newConnectionData = await this.prepareSession();
            if (this.isStopped) {
                this.isPreparing = false;
                return;
            }

            const { finalToken, whisperIp, whisperPort, onlineIp, onlinePort } = newConnectionData;

            const newWhisper = createTCPSocket();
            const newOnline = createTCPSocket();

            let whisperConnected = false;
            let onlineConnected = false;

            const checkAndSwitch = () => {
                if (whisperConnected && onlineConnected && !this.isStopped) {
                    const oldWhisper = this.tcpClients.whisper;
                    const oldOnline = this.tcpClients.online;

                    this.tcpClients.whisper = newWhisper;
                    this.tcpClients.online = newOnline;
                    this.connectionData = newConnectionData;
                    this.lastDataTime = Date.now();

                    this.tcpClients.whisper.on('data', () => { this.lastDataTime = Date.now(); });
                    this.tcpClients.whisper.on('close', () => { this.handleDisconnect(); });
                    this.tcpClients.whisper.on('error', () => { this.handleDisconnect(); });

                    this.tcpClients.online.on('data', () => { this.lastDataTime = Date.now(); });
                    this.tcpClients.online.on('close', () => { this.handleDisconnect(); });
                    this.tcpClients.online.on('error', () => { this.handleDisconnect(); });

                    if (oldWhisper) { try { oldWhisper.removeAllListeners(); oldWhisper.destroy(); } catch (e) {} }
                    if (oldOnline) { try { oldOnline.removeAllListeners(); oldOnline.destroy(); } catch (e) {} }
                }
            };

            newWhisper.connect(whisperPort, whisperIp, () => {
                newWhisper.write(Buffer.from(finalToken, 'hex'));
                whisperConnected = true;
                checkAndSwitch();
            });

            newOnline.connect(onlinePort, onlineIp, () => {
                newOnline.write(Buffer.from(finalToken, 'hex'));
                onlineConnected = true;
                checkAndSwitch();
            });

            newWhisper.on('error', () => {
                try { newWhisper.destroy(); } catch (e) {}
            });

            newOnline.on('error', () => {
                try { newOnline.destroy(); } catch (e) {}
            });

        } catch (e) {
        }
        
        this.isPreparing = false;
    }

    startPreemptiveReconnect() {
        if (this.preemptiveReconnectInterval) clearInterval(this.preemptiveReconnectInterval);
        this.preemptiveReconnectInterval = setInterval(() => {
            if (!this.isStopped && !this.isPreparing) {
                this.prepareNextSession();
            }
        }, 15000);
    }

    handleDisconnect() {
        if (this.isStopped || this.isReconnecting) return;
        this.isReconnecting = true;
        this.scheduleReconnect();
    }

    scheduleReconnect() {
        if (this.isStopped) return;
        this.setStatus('reconnecting');
        this.cleanupConnections();
        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = setTimeout(() => { if (!this.isStopped) this.connectSockets(); }, 50);
    }

    async start() {
        this.isStopped = false;
        this.setStatus('starting');
        try {
            await this.connectSockets();
        } catch (error) {
            this.setStatus('error');
            throw error;
        }
    }

    startHeartbeat() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = setInterval(() => {
            try {
                const ping = Buffer.from('00', 'hex');
                if (this.tcpClients.whisper && !this.tcpClients.whisper.destroyed) this.tcpClients.whisper.write(ping);
                if (this.tcpClients.online && !this.tcpClients.online.destroyed) this.tcpClients.online.write(ping);
            } catch (e) { this.handleDisconnect(); }
        }, 10000);
    }

    startConnectionCheck() {
        if (this.connectionCheckInterval) clearInterval(this.connectionCheckInterval);
        this.connectionCheckInterval = setInterval(() => {
            if (this.isStopped) return;
            
            const now = Date.now();
            const timeSinceLastData = now - this.lastDataTime;
            
            if (timeSinceLastData > 60000) {
                this.handleDisconnect();
                return;
            }
            
            const whisperOk = this.tcpClients.whisper && !this.tcpClients.whisper.destroyed && this.tcpClients.whisper.writable;
            const onlineOk = this.tcpClients.online && !this.tcpClients.online.destroyed && this.tcpClients.online.writable;
            
            if (!whisperOk || !onlineOk) {
                this.handleDisconnect();
            }
        }, 30000);
    }

    stop() {
        this.isStopped = true;
        if (this.reconnectTimeout) { clearTimeout(this.reconnectTimeout); this.reconnectTimeout = null; }
        this.cleanupConnections();
        this.setStatus('stopped');
    }
}

module.exports = SessionManager;

