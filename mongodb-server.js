const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');

const app = express();
const PORT = 3009;

const MONGO_URI = 'mongodb+srv://menorarey4444_db_user:o3OJ26nqf9FNtCq9@cluster0.x3xdouz.mongodb.net/?appName=Cluster0';
const DATABASE_NAME = 'sgpulse';
const USERS_COLLECTION = 'users';

app.use(cors());
app.use(express.json());

let db;
let usersCollection;

async function connectToMongoDB() {
    console.log('🔄 Tentando conectar ao MongoDB Atlas...');
    
    try {
        const client = new MongoClient(MONGO_URI, {
            serverSelectionTimeoutMS: 30000,
            connectTimeoutMS: 30000,
            socketTimeoutMS: 30000,
            family: 4,
            retryWrites: true,
        });

        await client.connect();
        await client.db('admin').command({ ping: 1 });

        db = client.db(DATABASE_NAME);
        usersCollection = db.collection(USERS_COLLECTION);

        await usersCollection.createIndex({ deviceId: 1 }, { unique: true });

        console.log('✅ Conectado ao MongoDB Atlas com sucesso!');
    } catch (error) {
        console.error('❌ Erro fatal de conexão:', error.message);
        process.exit(1);
    }
}

// Rotas
app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'Servidor funcionando' });
});

app.get('/stats', async (req, res) => {
    try {
        const total = await usersCollection.countDocuments();
        res.json({ totalUsers: total, status: 'online' });
    } catch (e) {
        res.json({ totalUsers: 0, status: 'online' });
    }
});

// Iniciar
async function start() {
    await connectToMongoDB();
    
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 SG PULSE Backend rodando na porta ${PORT}`);
    });
}

start().catch(console.error);
