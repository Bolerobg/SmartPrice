// Supabase Edge Function: create-donation-intent
// Създава Stripe PaymentIntent за еднократно или месечно дарение към SmartPrice.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { amountBgn, tierId, isMonthly, userId, userEmail } = await req.json();
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');

    if (!amountBgn || amountBgn < 1) {
      throw new Error('Минималната сума за дарение е 1 лв.');
    }

    if (!stripeSecretKey) {
      // Демо режим когато все още не е добавен STRIPE_SECRET_KEY в Supabase Secrets
      return new Response(
        JSON.stringify({
          mode: 'demo',
          paymentIntentId: `pi_smartprice_${Date.now()}`,
          clientSecret: `pi_smartprice_secret_${Date.now()}`,
          amountBgn,
          tierId,
          isMonthly,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2023-10-16',
      httpClient: Stripe.createFetchHttpClient(),
    });

    // Сумата в стотинки (1 лв. = 100 ст.)
    const amountInStotinki = Math.round(Number(amountBgn) * 100);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInStotinki,
      currency: 'bgn',
      automatic_payment_methods: { enabled: true },
      receipt_email: userEmail || undefined,
      metadata: {
        app: 'SmartPrice',
        userId: userId || 'anonymous',
        tierId: tierId || 'custom',
        isMonthly: String(Boolean(isMonthly)),
      },
      description: `SmartPrice Дарение (${tierId || 'Общност'}) - ${amountBgn} лв.`,
    });

    return new Response(
      JSON.stringify({
        mode: 'live',
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        amountBgn,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
