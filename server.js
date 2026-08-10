const express = require('express');
const session = require('express-session');
const path = require('node:path');

require('./db'); // ensures schema is created on startup

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const inventoryRoutes = require('./routes/inventory');
const batchRoutes = require('./routes/batches');
const outflowRoutes = require('./routes/outflow');
const transactionRoutes = require('./routes/transactions');
const supplierRoutes = require('./routes/suppliers');
const claimRoutes = require('./routes/claims');
const customerRoutes = require('./routes/customers');
const purchaseOrderRoutes = require('./routes/purchase-orders');

const app = express();
const PORT = process.env.PORT || 3300;
const isProd = process.env.NODE_ENV === 'production';

if (isProd) app.set('trust proxy', 1);

app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || 'pitchstock-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === '1',
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
  },
}));

app.use('/api', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/batches', batchRoutes);
app.use('/api/outflow', outflowRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/claims', claimRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`pitchstock running on http://localhost:${PORT}`);
});
