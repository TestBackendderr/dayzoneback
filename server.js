const express = require('express');
const cors = require('cors');
// const helmet = require('helmet'); // Отключено для разработки
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const stalkerRoutes = require('./routes/stalkers');
const financeRoutes = require('./routes/finances');
const wantedRoutes = require('./routes/wanted');
const groupingRoutes = require('./routes/groupings');
const contractRoutes = require('./routes/contracts');
const groupContractRoutes = require('./routes/groupContracts');
const groupChatRoutes = require('./routes/groupChat');
const orgChatRoutes = require('./routes/orgChat');
const alterEgoRoutes = require('./routes/alterEgos');
const groupMapRoutes = require('./routes/groupMaps');
const groupInfoRoutes = require('./routes/groupInfo');

const app = express();
const PORT = process.env.PORT || 5000;

// CORS должен быть первым!
app.use(cors({
  origin: true, // Разрешаем все домены для разработки
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  optionsSuccessStatus: 200
}));

// Дополнительные CORS заголовки
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Security middleware - отключено для разработки
// app.use(helmet({
//   crossOriginResourcePolicy: { policy: "cross-origin" },
//   crossOriginEmbedderPolicy: false
// }));

// Rate limiting - отключено для разработки
// const limiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 100 // limit each IP to 100 requests per windowMs
// });
// app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files for uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/stalkers', stalkerRoutes);
app.use('/api/finances', financeRoutes);
app.use('/api/wanted', wantedRoutes);
app.use('/api/groupings', groupingRoutes);
app.use('/api/contracts', contractRoutes);
app.use('/api/group-contracts', groupContractRoutes);
app.use('/api/group-chat', groupChatRoutes);
app.use('/api/org-chat', orgChatRoutes);
app.use('/api/alter-egos', alterEgoRoutes);
app.use('/api/group-maps', groupMapRoutes);
app.use('/api/group-info', groupInfoRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'DayZone API работает',
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    message: 'Внутренняя ошибка сервера',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Что-то пошло не так'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Эндпоинт не найден' });
});

app.listen(PORT, () => {
  console.log(`☢ DayZone Backend запущен на порту ${PORT}`);
  console.log(`🚀 API доступен по адресу: http://localhost:${PORT}/api`);
});
