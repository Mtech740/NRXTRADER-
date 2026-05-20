async function fetchLatest() {

    const res = await fetch('/api/admin/latest-signals?secret=' + ADMIN_SECRET);

    const data = await res.json();

    if (!data.signals || data.signals.length === 0) {
        document.getElementById('signalCard').innerHTML =
            '<p style="color:red">No pending signals</p>';
        return;
    }

    let html = '';

    for (const item of data.signals) {

        const sig = item.signal;

        html += `
        <div class="signal-card">
            <h2>${sig.asset_symbol} - ${sig.signal_type}</h2>

            <p><strong>Entry:</strong> ${sig.entry_price}</p>
            <p><strong>TP:</strong> ${sig.take_profit}</p>
            <p><strong>SL:</strong> ${sig.stop_loss}</p>
            <p><strong>Confidence:</strong> ${sig.confidence}</p>

            <h3>Recipients</h3>
        `;

        if (item.whatsapp_numbers.length > 0) {

            for (const phone of item.whatsapp_numbers) {

                let cleanPhone = phone.replace(/\D/g, '');

                const message =
`📢 SYNA SIGNAL

Asset: ${sig.asset_symbol}
Action: ${sig.signal_type}
Entry: ${sig.entry_price}
TP: ${sig.take_profit}
SL: ${sig.stop_loss}
Confidence: ${sig.confidence}`;

                const waLink =
`https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;

                html += `
                <div class="number-item">
                    <span>${phone}</span>
                    <a href="${waLink}" target="_blank" class="send-btn">
                        Send WhatsApp
                    </a>
                </div>
                `;
            }

        } else {

            html += `<p>No subscribers for this asset.</p>`;
        }

        html += `</div>`;
    }

    document.getElementById('signalCard').innerHTML = html;
}
