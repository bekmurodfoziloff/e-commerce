import { Router } from 'express';
import Stripe from 'stripe';
import paymentsService from '../services/payments.service.js';
import authMiddleware from '../middlewares/auth.middleware.js';
import { isCustomerPayment } from '../middlewares/isCustomerPayment.middleware.js';
import redisService from '../services/redis.service.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

class PaymentsController {
  path = '/payment';
  router = Router();

  constructor() {
    this.setRoutes();
  }

  setRoutes() {
    this.router.route(`${this.path}/:paymentId`).get(authMiddleware, isCustomerPayment, this.findPaymentById);
    this.router.route(`${this.path}`).get(authMiddleware, this.findAllPayments);
    this.router.route(`${this.path}`).post(authMiddleware, this.createPayment);
  }

  async findPaymentById(req, res, next) {
    try {
      const { paymentId } = req.params;
      const cachedPayment = await redisService.getValue(`payment:${paymentId}`);
      if (cachedPayment) {
        return res.status(200).json(cachedPayment);
      } else {
        const payment = await stripe.charges.retrieve(paymentId);
        if (payment) {
          await redisService.setValue(`payment:${paymentId}`, payment);
          return res.status(200).json(payment);
        }
        return res.status(404).json(`Payment with id ${paymentId} not found`);
      }
    } catch (error) {
      return res.status(error.status || 500).json({ error: error.message });
    }
  }

  async findAllPayments(req, res, next) {
    try {
      const { page } = req.query;
      const cachedPayments = await redisService.getValue('payments');
      if (cachedPayments && !page) {
        return res.status(200).json(cachedPayments);
      } else {
        const payments = await paymentsService.findAllPayments(req.user.id, page);
        await redisService.setValue('payments', payments);
        return res.status(200).json(payments);
      }
    } catch (error) {
      return res.status(error.status || 500).json({ error: error.message });
    }
  }

  async createPayment(req, res, next) {
    try {
      const { orderId, customerId, amount } = req.body;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount * 100,
        currency: 'usd',
        description: `Payment for order ${orderId}`
      });
      const payment = await paymentsService.createPayment({
        order: orderId,
        customer: customerId,
        amount,
        paymentStatus: paymentIntent.status,
        paymentId: paymentIntent.id
      });
      await redisService.setValue(`payment:${paymentIntent.id}`, paymentIntent);
      res.status(201).json(payment);
    } catch (error) {
      return res.status(error.status || 500).json({ error: error.message });
    }
  }
}

export default new PaymentsController().router;
