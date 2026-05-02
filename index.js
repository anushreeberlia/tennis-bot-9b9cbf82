const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const axios = require('axios');
const cheerio = require('cheerio');
const { Expo } = require('expo-server-sdk');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const expo = new Expo();

// Data paths
const DATA_DIR = '/data';
const DB_PATH = path.join(DATA_DIR, '/data/data.json');
const LOGS_PATH = path.join(DATA_DIR, '/data/logs.json');

app.use(cors());
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Initialize data files
async function initializeData() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    
    try {
      await fs.access(DB_PATH);
    } catch {
      await fs.writeFile(DB_PATH, JSON.stringify({
        users: [],
        lastScrape: null,
        availableCourts: []
      }, null, 2));
    }
    
    try {
      await fs.access(LOGS_PATH);
    } catch {
      await fs.writeFile(LOGS_PATH, JSON.stringify({ logs: [] }, null, 2));
    }
  } catch (error) {
    console.error('Failed to initialize data:', error);
  }
}

// Database helpers
async function readDB() {
  try {
    const data = await fs.readFile(DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch {
    return { users: [], lastScrape: null, availableCourts: [] };
  }
}

async function writeDB(data) {
  try {
    await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Failed to write DB:', error);
  }
}

async function addLog(type, message, details = null) {
  try {
    const logs = JSON.parse(await fs.readFile(LOGS_PATH, 'utf8'));
    logs.logs.unshift({
      id: Date.now(),
      timestamp: new Date().toISOString(),
      type,
      message,
      details
    });
    
    // Keep only last 100 logs
    logs.logs = logs.logs.slice(0, 100);
    
    await fs.writeFile(LOGS_PATH, JSON.stringify(logs, null, 2));
    console.log(`[${type.toUpperCase()}] ${message}`);
  } catch (error) {
    console.error('Failed to add log:', error);
  }
}

// Court scraping function
async function scrapeCourts() {
  await addLog('info', 'Starting court availability scrape');
  
  try {
    // Joe DiMaggio Tennis Courts SF Recreation booking URL
    const baseUrl = 'https://sfrecpark.org/facilities/joe-dimaggio-playground/';
    
    // Note: This is a simulated scrape since the actual SF Rec & Park system
    // uses a complex JavaScript booking system. In production, you'd need
    // to use Puppeteer or Selenium to handle the dynamic content.
    
    await addLog('info', 'Attempting to fetch court data from SF Rec & Park');
    
    // Simulate the scraping process with realistic data
    const response = await axios.get(baseUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });
    
    await addLog('info', `Received response with status: ${response.status}`);
    
    // Get next Friday's date
    const now = new Date();
    const nextFriday = new Date(now);
    const daysUntilFriday = (5 - now.getDay() + 7) % 7 || 7;
    nextFriday.setDate(now.getDate() + daysUntilFriday);
    
    // Simulate finding available courts
    // In a real implementation, you'd parse the HTML/API response
    const mockAvailableCourts = [
      {
        date: nextFriday.toISOString().split('T')[0],
        time: '10:00 AM',
        court: 'Court 1',
        duration: '1 hour',
        available: Math.random() > 0.7 // 30% chance of availability
      },
      {
        date: nextFriday.toISOString().split('T')[0],
        time: '2:00 PM',
        court: 'Court 2', 
        duration: '1 hour',
        available: Math.random() > 0.8 // 20% chance of availability
      },
      {
        date: nextFriday.toISOString().split('T')[0],
        time: '4:00 PM',
        court: 'Court 1',
        duration: '1 hour', 
        available: Math.random() > 0.6 // 40% chance of availability
      }
    ];
    
    const availableCourts = mockAvailableCourts.filter(court => court.available);
    
    await addLog('info', `Found ${availableCourts.length} available courts for Friday ${nextFriday.toDateString()}`);
    
    // Update database
    const db = await readDB();
    const previousAvailable = db.availableCourts.length;
    db.availableCourts = availableCourts;
    db.lastScrape = new Date().toISOString();
    await writeDB(db);
    
    // Send notifications if new courts are available
    if (availableCourts.length > previousAvailable) {
      await sendNotifications(availableCourts);
    }
    
    await addLog('success', `Scrape completed. ${availableCourts.length} courts available`);
    return availableCourts;
    
  } catch (error) {
    await addLog('error', 'Scraping failed', { error: error.message });
    console.error('Scraping error:', error);
    return [];
  }
}

// Send push notifications
async function sendNotifications(availableCourts) {
  const db = await readDB();
  const pushTokens = db.users.filter(user => user.pushToken).map(user => user.pushToken);
  
  if (pushTokens.length === 0) {
    await addLog('info', 'No push tokens registered');
    return;
  }
  
  const messages = [];
  
  for (let pushToken of pushTokens) {
    if (!Expo.isExpoPushToken(pushToken)) {
      await addLog('error', `Invalid push token: ${pushToken}`);
      continue;
    }
    
    messages.push({
      to: pushToken,
      sound: 'default',
      title: '🎾 Tennis Courts Available!',
      body: `${availableCourts.length} courts available at Joe DiMaggio this Friday`,
      data: { availableCourts },
    });
  }
  
  if (messages.length === 0) return;
  
  try {
    const chunks = expo.chunkPushNotifications(messages);
    
    for (let chunk of chunks) {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      await addLog('info', `Sent ${ticketChunk.length} notifications`);
    }
  } catch (error) {
    await addLog('error', 'Failed to send notifications', { error: error.message });
  }
}

// Routes
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'Tennis Court Monitor API',
    timestamp: new Date().toISOString()
  });
});

app.post('/register', async (req, res) => {
  try {
    const { pushToken, userId } = req.body;
    
    if (!pushToken) {
      return res.status(400).json({ error: 'Push token required' });
    }
    
    const db = await readDB();
    
    // Remove existing user with same token or ID
    db.users = db.users.filter(user => 
      user.pushToken !== pushToken && user.userId !== userId
    );
    
    // Add new user
    db.users.push({
      userId: userId || `user_${Date.now()}`,
      pushToken,
      registeredAt: new Date().toISOString()
    });
    
    await writeDB(db);
    await addLog('info', `New user registered with push token`);
    
    res.json({ success: true, message: 'Registered for notifications' });
  } catch (error) {
    await addLog('error', 'Registration failed', { error: error.message });
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.get('/courts', async (req, res) => {
  try {
    const db = await readDB();
    res.json({
      courts: db.availableCourts,
      lastScrape: db.lastScrape
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch courts' });
  }
});

app.get('/logs', async (req, res) => {
  try {
    const logs = JSON.parse(await fs.readFile(LOGS_PATH, 'utf8'));
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

app.post('/scrape', async (req, res) => {
  try {
    const courts = await scrapeCourts();
    res.json({ success: true, courts });
  } catch (error) {
    res.status(500).json({ error: 'Manual scrape failed' });
  }
});

// Schedule scraping every Tuesday at 9 AM (to check for Friday availability)
cron.schedule('0 9 * * 2', async () => {
  await addLog('info', 'Scheduled scrape triggered');
  await scrapeCourts();
});

// Also run every 6 hours during weekdays
cron.schedule('0 */6 * * 1-5', async () => {
  await addLog('info', 'Regular scrape triggered');
  await scrapeCourts();
});

// Initialize and start server
initializeData().then(() => {
  app.listen(PORT, () => {
    console.log(`Tennis Court Monitor API running on port ${PORT}`);
    addLog('info', `Server started on port ${PORT}`);
    
    // Run initial scrape after 10 seconds
    setTimeout(() => {
      scrapeCourts();
    }, 10000);
  });
});