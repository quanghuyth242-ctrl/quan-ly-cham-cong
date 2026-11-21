(() => {
    const container = document.getElementById('schedule-sync');
    const status = document.getElementById('schedule-sync-status');
    const refreshButton = document.getElementById('schedule-sync-refresh');
    if (!container || !status || !refreshButton) return;

    let revision = container.dataset.revision || '';
    let refreshPending = false;

    const canRefreshWithoutLosingInput = () => {
        const modal = document.querySelector('[id$="-modal"]');
        const modalIsOpen = modal && !modal.classList.contains('hidden');
        const activeElement = document.activeElement;
        const editingField = activeElement && activeElement.matches('input, select, textarea, [contenteditable="true"]');
        return !modalIsOpen && !editingField;
    };

    const offerRefresh = () => {
        refreshPending = true;
        status.textContent = 'Có thay đổi mới về ca hoặc lịch trực.';
        refreshButton.classList.remove('hidden');
        refreshButton.classList.add('inline-flex');

        if (canRefreshWithoutLosingInput()) window.location.reload();
    };

    const checkForChanges = async () => {
        if (document.hidden || refreshPending) return;

        try {
            const response = await fetch('/admin/shifts/sync-state', {
                headers: { Accept: 'application/json' },
                cache: 'no-store'
            });
            if (!response.ok) return;

            const data = await response.json();
            if (!data.revision) return;
            if (!refreshPending) {
                status.textContent = 'Đồng bộ tự động đang bật · kiểm tra thay đổi mỗi 20 giây.';
            }
            if (!revision) {
                revision = data.revision;
                container.dataset.revision = revision;
                return;
            }
            if (data.revision !== revision) offerRefresh();
        } catch {
            status.textContent = 'Tạm thời chưa kết nối được trạng thái đồng bộ.';
        }
    };

    refreshButton.addEventListener('click', () => {
        if (!canRefreshWithoutLosingInput()
            && !window.confirm('Tải lại trang sẽ bỏ nội dung chưa lưu. Bạn có muốn tiếp tục?')) return;
        window.location.reload();
    });

    window.setInterval(checkForChanges, 20_000);
})();
