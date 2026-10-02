app.get('/api/dashboard', async (req, res) => {
    const token = requireToken(req, res);
    if (!token) return;

    try {
        const userResult =
            await mlFetch('/users/me', token);

        if (
            !userResult.response.ok ||
            !userResult.data?.id
        ) {
            return res.status(401).json({
                erro: 'Token inválido ou expirado.'
            });
        }

        const sellerId = userResult.data.id;

        const agora = new Date();

        const inicio = new Date(
            agora.getTime() -
            60 * 24 * 60 * 60 * 1000
        );

        const ordersMap = new Map();

        let cursor = new Date(inicio);

        while (cursor < agora) {

            const fim = new Date(
                Math.min(
                    cursor.getTime() +
                    15 * 24 * 60 * 60 * 1000,
                    agora.getTime()
                )
            );

            let offset = 0;

            while (true) {

                const params = new URLSearchParams({
                    seller: String(sellerId),
                    'order.status': 'paid',
                    'order.date_created.from':
                        cursor.toISOString(),
                    'order.date_created.to':
                        fim.toISOString(),
                    sort: 'date_desc',
                    limit: '50',
                    offset: String(offset)
                });

                const result = await mlFetch(
                    `/orders/search?${params.toString()}`,
                    token
                );

                if (!result.response.ok) {
                    return res.status(
                        result.response.status
                    ).json({
                        erro:
                            result.data?.message ||
                            'Erro ao consultar vendas.'
                    });
                }

                const orders =
                    Array.isArray(
                        result.data?.results
                    )
                    ? result.data.results
                    : [];

                if (!orders.length) break;

                for (const order of orders) {

                    if (order?.id) {

                        ordersMap.set(
                            String(order.id),
                            order
                        );

                    }

                }

                offset += orders.length;

                if (
                    orders.length < 50 ||
                    offset >=
                    Number(
                        result.data?.paging?.total || 0
                    ) ||
                    offset >= 10000
                ) {
                    break;
                }
            }

            cursor = fim;
        }

        const orders =
            Array.from(
                ordersMap.values()
            );

        let faturamento = 0;
        let unidades = 0;

        const produtos = new Map();
        const dias = new Map();

        for (const order of orders) {

            faturamento += Number(
                order.total_amount ??
                order.paid_amount ??
                0
            );

            const data =
                order.date_created
                ? new Date(order.date_created)
                : null;

            if (
                data &&
                !isNaN(data.getTime())
            ) {

                const dia =
                    data.toISOString()
                        .slice(0, 10);

                dias.set(
                    dia,
                    (dias.get(dia) || 0) + 1
                );
            }

            const orderItems =
                Array.isArray(order.order_items)
                ? order.order_items
                : [];

            for (const orderItem of orderItems) {

                const item =
                    orderItem.item || {};

                const id =
                    String(
                        item.id ||
                        'SEM_ID'
                    );

                const quantidade =
                    Number(
                        orderItem.quantity || 1
                    );

                const preco =
                    Number(
                        orderItem.unit_price || 0
                    );

                if (!produtos.has(id)) {

                    produtos.set(id, {
                        id,
                        title:
                            item.title ||
                            'Produto sem título',
                        sku:
                            item.seller_custom_field ||
                            null,
                        sales: 0,
                        revenue: 0,
                        orders: 0
                    });

                }

                const produto =
                    produtos.get(id);

                produto.sales +=
                    quantidade;

                produto.revenue +=
                    preco * quantidade;

                produto.orders += 1;

                unidades +=
                    quantidade;
            }
        }

        const top10 =
            Array.from(
                produtos.values()
            )
            .sort(
                (a, b) =>
                    b.sales - a.sales ||
                    b.revenue - a.revenue
            )
            .slice(0, 10);

        const series = [];

        for (let i = 59; i >= 0; i--) {

            const data =
                new Date(
                    agora.getTime() -
                    i * 24 * 60 * 60 * 1000
                );

            const dia =
                data.toISOString()
                    .slice(0, 10);

            series.push({
                date: dia,
                value:
                    dias.get(dia) || 0
            });
        }

        const pedidos =
            orders.length;

        const ticket =
            pedidos
            ? faturamento / pedidos
            : 0;

        res.json({

            periodo_dias: 60,

            total_pedidos:
                pedidos,

            vendas_60_dias:
                pedidos,

            total_unidades:
                unidades,

            faturamento_60_dias:
                Number(
                    faturamento.toFixed(2)
                ),

            ticket_medio:
                Number(
                    ticket.toFixed(2)
                ),

            top_10:
                top10.map(item => ({
                    ...item,
                    revenue:
                        Number(
                            item.revenue.toFixed(2)
                        )
                })),

            series_60_dias:
                series,

            ultima_atualizacao:
                new Date().toISOString()
        });

    } catch (e) {

        console.error(
            'Erro dashboard:',
            e
        );

        res.status(500).json({
            erro:
                'Erro ao montar dashboard: ' +
                e.message
        });
    }
});
