const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const dns = require('dns');

const app = express();
const PORT = 3009;

// Configuração do MongoDB com opções de DNS
const MONGO_URI = 'mongodb+srv://menorarey4444_db_user:o3OJ26nqf9FNtCq9@cluster0.x3xdouz.mongodb.net/?appName=Cluster0';
const DATABASE_NAME = 'sgpulse';
const USERS_COLLECTION = 'users';

// Configurar DNS para usar servidores públicos
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

// Middleware
app.use(cors());
app.use(express.json());

let db;
let usersCollection;

// Função para limpar cache DNS
function clearDNSCache() {
    console.log('🔄 Limpando cache DNS...');
    
    // Limpar cache DNS no Windows
    if (process.platform === 'win32') {
        const { exec } = require('child_process');
        exec('ipconfig /flushdns', (error, stdout, stderr) => {
            if (error) {
                console.log('⚠️  Não foi possível limpar cache DNS automaticamente');
            } else {
                console.log('✅ Cache DNS limpo');
            }
        });
    }
    
    // Configurar servidores DNS alternativos
    dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1', '208.67.222.222']);
}

// Conectar ao MongoDB com retry e configurações DNS
async function connectToMongoDB() {
    const maxRetries = 5;
    let retryCount = 0;
    
    while (retryCount < maxRetries) {
        try {
            console.log(`🔄 Tentativa ${retryCount + 1}/${maxRetries} de conexão ao MongoDB...`);
            
            // Limpar DNS cache na primeira tentativa
            if (retryCount === 0) {
                clearDNSCache();
            }
            
            // Configurações de conexão com timeout e DNS
            const client = new MongoClient(MONGO_URI, {
                serverSelectionTimeoutMS: 10000, // 10 segundos
                connectTimeoutMS: 10000,
                socketTimeoutMS: 10000,
                family: 4, // Forçar IPv4
                maxPoolSize: 10,
                retryWrites: true,
                w: 'majority'
            });
            
            await client.connect();
            
            // Testar conexão
            await client.db('admin').command({ ping: 1 });
            
            db = client.db(DATABASE_NAME);
            usersCollection = db.collection(USERS_COLLECTION);
            
            // Criar índice único para deviceId
            await usersCollection.createIndex({ deviceId: 1 }, { unique: true });
            
            console.log('✅ Conectado ao MongoDB Atlas com sucesso!');
            return;
            
        } catch (error) {
            retryCount++;
            console.error(`❌ Tentativa ${retryCount} falhou:`, error.message);
            
            if (retryCount < maxRetries) {
                console.log(`⏳ Aguardando 3 segundos antes da próxima tentativa...`);
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                // Tentar diferentes servidores DNS
                if (retryCount === 2) {
                    dns.setServers(['1.1.1.1', '1.0.0.1']);
                    console.log('🔄 Mudando para DNS Cloudflare...');
                } else if (retryCount === 3) {
                    dns.setServers(['208.67.222.222', '208.67.220.220']);
                    console.log('🔄 Mudando para DNS OpenDNS...');
                }
            }
        }
    }
    
    console.error('❌ Falha ao conectar ao MongoDB após todas as tentativas');
    console.log('🔧 Soluções possíveis:');
    console.log('   1. Verificar conexão com internet');
    console.log('   2. Verificar firewall/antivírus');
    console.log('   3. Tentar usar VPN');
    console.log('   4. Verificar configurações de proxy');
    console.log('   5. Executar: ipconfig /flushdns (Windows)');
    
    process.exit(1);
}

// Função para gerar próximo ID sequencial
async function getNextUserId() {
    const lastUser = await usersCollection.findOne({}, { sort: { id: -1 } });
    return lastUser ? lastUser.id + 1 : 1;
}

// Rota: Encontrar usuário por Device ID
app.post('/user/find', async (req, res) => {
    try {
        const { deviceId } = req.body;
        
        if (!deviceId) {
            return res.status(400).json({ error: 'Device ID é obrigatório' });
        }
        
        const user = await usersCollection.findOne({ deviceId });
        
        if (user) {
            // Atualizar último login
            await usersCollection.updateOne(
                { deviceId },
                { $set: { lastLogin: new Date() } }
            );
            
            res.json({
                found: true,
                user: user
            });
        } else {
            res.json({
                found: false,
                user: null
            });
        }
    } catch (error) {
        console.error('Erro ao buscar usuário:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Rota: Criar novo usuário
app.post('/user/create', async (req, res) => {
    try {
        const { deviceId, username, country, gems = 0, coins = 1000, crowns = 0, trophys = 0, experience = 0, banned = false } = req.body;
        
        if (!deviceId || !username || !country) {
            return res.status(400).json({ error: 'Device ID, username e country são obrigatórios' });
        }
        
        // Verificar se já existe usuário com este deviceId
        const existingUser = await usersCollection.findOne({ deviceId });
        if (existingUser) {
            return res.status(409).json({ error: 'Usuário já existe para este dispositivo' });
        }
        
        // Gerar ID sequencial
        const newId = await getNextUserId();
        
        const newUser = {
            id: newId,
            deviceId,
            username,
            country,
            gems,
            coins,
            crowns,
            trophys,
            experience,
            banned,
            createdAt: new Date(),
            lastLogin: new Date()
        };
        
        await usersCollection.insertOne(newUser);
        
        console.log(`✅ Novo usuário criado: ID=${newId}, Username=${username}, Device=${deviceId}`);
        
        res.json({
            success: true,
            user: newUser
        });
    } catch (error) {
        console.error('Erro ao criar usuário:', error);
        if (error.code === 11000) {
            res.status(409).json({ error: 'Device ID já existe' });
        } else {
            res.status(500).json({ error: 'Erro interno do servidor' });
        }
    }
});

// Rota: Login do usuário
app.post('/user/login', async (req, res) => {
    try {
        const { id } = req.body;
        
        if (!id) {
            return res.status(400).json({ error: 'ID do usuário é obrigatório' });
        }
        
        const user = await usersCollection.findOne({ id: parseInt(id) });
        
        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }
        
        // Atualizar último login
        await usersCollection.updateOne(
            { id: parseInt(id) },
            { $set: { lastLogin: new Date() } }
        );
        
        console.log(`✅ Login realizado: ID=${id}, Username=${user.username}`);
        
        res.json({
            success: true,
            user: user
        });
    } catch (error) {
        console.error('Erro no login:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Rota: Atualizar username
app.post('/user/update-username', async (req, res) => {
    try {
        const { id, username } = req.body;
        
        if (!id || !username) {
            return res.status(400).json({ error: 'ID e username são obrigatórios' });
        }
        
        // Validar username
        if (username.length < 4 || username.length > 20) {
            return res.status(400).json({ error: 'Username deve ter entre 4 e 20 caracteres' });
        }
        
        if (/[=#{}\[\]]/.test(username)) {
            return res.status(400).json({ error: 'Username contém caracteres inválidos' });
        }
        
        const result = await usersCollection.updateOne(
            { id: parseInt(id) },
            { $set: { username: username } }
        );
        
        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }
        
        console.log(`✅ Username atualizado: ID=${id}, Novo username=${username}`);
        
        res.json({
            success: true,
            message: 'Username atualizado com sucesso'
        });
    } catch (error) {
        console.error('Erro ao atualizar username:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Rota: Listar todos os usuários (para debug)
app.get('/users', async (req, res) => {
    try {
        const users = await usersCollection.find({}).sort({ id: 1 }).toArray();
        res.json({
            count: users.length,
            users: users
        });
    } catch (error) {
        console.error('Erro ao listar usuários:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Rota: Estatísticas
app.get('/stats', async (req, res) => {
    try {
        const totalUsers = await usersCollection.countDocuments();
        const bannedUsers = await usersCollection.countDocuments({ banned: true });
        const recentUsers = await usersCollection.countDocuments({
            createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        });
        
        res.json({
            totalUsers,
            bannedUsers,
            activeUsers: totalUsers - bannedUsers,
            recentUsers
        });
    } catch (error) {
        console.error('Erro ao obter estatísticas:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Rota: Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date(),
        uptime: process.uptime()
    });
});

// Iniciar servidor
async function startServer() {
    await connectToMongoDB();
    
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Servidor SG PULSE MongoDB rodando na porta ${PORT}`);
        console.log(`📊 Acesse http://localhost:${PORT}/stats para estatísticas`);
        console.log(`👥 Acesse http://localhost:${PORT}/users para listar usuários`);
        console.log(`❤️  Acesse http://localhost:${PORT}/health para health check`);
    });
}

// Tratamento de erros
process.on('unhandledRejection', (error) => {
    console.error('❌ Erro não tratado:', error);
});

process.on('SIGINT', () => {
    console.log('\n👋 Encerrando servidor...');
    process.exit(0);
});

// Iniciar
startServer().catch(console.error);