const path = require('path');
const express = require('express');
const mongodb = require('mongodb');
const MongoClient = mongodb.MongoClient;
const connectionURL = process.env.MONGODB_URI;
const databaseName = process.env.DB_NAME;

const getRawBody = require('raw-body')
const crypto = require('crypto')


// connect to the database
MongoClient.connect(connectionURL, { useNewUrlParser: true }, (error, client) => {
  if (error) {
    console.log('Could not connect to MongoDB database');
    console.log(error);
    return;
  }

  // successfully connected to database. start application.

  const db = client.db(databaseName);
  const port = process.env.PORT || 3000;
  const app = express();

  // I'm using pug to render views.
  app.set('view engine', 'pug');

  // Middleware that runs before body is parsed, to verify the if the webhook is called by shopify.
  app.post('/order/create', function (req, res, next) {
    req.rawBody = '';
    req.on('data', function (chunk) {
      req.rawBody += chunk.toString('utf8');
    });
    req.on('end', function () {

      let jsonString = JSON.stringify(req.rawBody)
      let SECRET = process.env.SECRET_KEY;

      var digest = crypto.createHmac('SHA256', SECRET)
        .update(new Buffer(req.rawBody, 'utf8'))
        .digest('base64');

      req['shopify_hash_verify'] = (req.headers['x-shopify-hmac-sha256'] === digest)
    });

    next();
  });

  app.use(express.static(path.join(__dirname, '../public')));
  app.use(express.json())
  app.use(express.urlencoded({ extended: true }))

  // Webhook to get order details from shopify
  app.post('/order/create', (req, res) => {
    const data = req.body;

    // If hash is verified, enter the details into db or else return response as 403.
    req['shopify_hash_verify'] ?
      db.collection('orders').insertOne({
        order_id: data.id,
        customer_id: data.customer.id,
        customer_email: data.customer.email,
        customer_first_name: data.customer.first_name,
        customer_last_name: data.customer.last_name
      }).then((result) => {
        res.sendStatus(200);
      }).catch((error) => {
        console.log(error);
        res.sendStatus(403)
      }) : res.sendStatus(403);

  });

  // Page to show all orders.
  app.get('/', (req, res) => {
    db.collection('orders').find({}).toArray().then((data) => {
      res.render('show_orders', { data: data, notification: req.query.notification });
    });
  });

  // Page to edit any order data.
  app.get('/orders/edit/:document_id/:order_id', (req, res) => {

    db.collection('orders').findOne({
      _id: mongodb.ObjectID(req.params.document_id),
      order_id: parseInt(req.params.order_id)
    }).then((data) => {
      res.render('edit_form', { data: data });
    }).catch((error) => {
      console.log(error);
    });

  });

  // Post call to update order data.
  app.post('/orders/edit/:document_id/:order_id', (req, res) => {

    let update_ob = {}
    if (req.body.email && (req.body.email != ''))
      update_ob['customer_email'] = req.body.email;
    if (req.body.first_name && (req.body.first_name != ''))
      update_ob['customer_first_name'] = req.body.first_name;
    if (req.body.last_name && (req.body.last_name != ''))
      update_ob['customer_last_name'] = req.body.last_name;

    db.collection('orders').findOneAndUpdate({
      _id: mongodb.ObjectID(req.params.document_id),
      order_id: parseInt(req.params.order_id)
    }, {
        $set: update_ob
      }).then((data) => {
        res.redirect('/?notification=true');
      }).catch((error) => {
        console.log(error);
      });
  });

  // Lister on port number provided by heroku or at 3000.
  app.listen(port, () => {
    console.log('App has started');
  });


});