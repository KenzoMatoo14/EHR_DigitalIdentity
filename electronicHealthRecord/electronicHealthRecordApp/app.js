var createError = require('http-errors');
var express = require('express');
var logger = require('morgan');

var fichaIdentificacionRouter = require('./routes/fichaIdentificacion');
var antecedentesRouter = require('./routes/antecedentes');
var notaSoapRouter = require('./routes/notaSoap');
var pacientesRouter = require('./routes/pacientes');
var chainIdentityRouter = require('./routes/chainIdentity');

var app = express();

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use('/fichaIdentificacion', fichaIdentificacionRouter);
app.use('/antecedentes', antecedentesRouter);
app.use('/notaSoap', notaSoapRouter);
app.use('/pacientes', pacientesRouter);
app.use('/chainIdentity', chainIdentityRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler — esta app solo sirve JSON (no hay vistas)
app.use(function(err, req, res, next) {
  res.status(err.status || 500);
  res.json({ Result: 'Error', Description: err.message });
});

module.exports = app;
