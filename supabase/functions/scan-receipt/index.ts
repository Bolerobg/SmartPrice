// Supabase Edge Function: scan-receipt
// Извлича структурирани данни (търговец, ЕИК, дата, артикули, сума) от снимка на касова бележка чрез Vision AI.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { imageBase64, categoryHint, polarityHint } = await req.json();
    const openAiKey = Deno.env.get('OPENAI_API_KEY');

    if (openAiKey && imageBase64) {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openAiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                'Ти си AI OCR скенер за български фискални касови бележки и фактури. Върни JSON с ключове: merchantName, merchantTaxId, date, time, totalAmount (число), currency ("лв."), confidenceScore (0-1) и items (масив от { id, name, quantity, unitPrice, totalPrice, highlightReason }).',
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `Сканирай тази касова бележка (категория: ${categoryHint || 'обща'}, тип: ${polarityHint || 'green'}).`,
                },
                {
                  type: 'image_url',
                  image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
                },
              ],
            },
          ],
        }),
      });

      const result = await response.json();
      const parsed = JSON.parse(result.choices[0].message.content);
      return new Response(JSON.stringify({ ...parsed, verifiedByAi: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        error: 'OPENAI_API_KEY not configured on Edge Function; using local smart OCR fallback.',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
