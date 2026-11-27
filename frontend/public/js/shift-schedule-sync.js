(() => {
    'use strict';

    const container = document.getElementById('schedule-sync');
    const status = document.getElementById('schedule-sync-status');
    const refreshButton = document.getElementById('schedule-sync-refresh');
    const toggle = document.getElementById('schedule-sync-toggle');
    const intervalSelect = document.getElementById('schedule-sync-interval');
    if (!container || !status || !refreshButton) return;

    const DEFAULT_INTERVAL = 30000;
    const ALLOWED_INTERVALS = [15000, 30000, 60000];
    const STORAGE_ENABLED = 'shift_schedule_auto_sync';
    const STORAGE_INTERVAL = 'shift_schedule_sync_interval';

    let revision = container.dataset.revision || '';
    let refreshPending = false;
    let pendingSnapshot = null;
    let timer = null;

    let enabled = localStorage.getItem(STORAGE_ENABLED) !== '0';
    let intervalMs = Number(localStorage.getItem(STORAGE_INTERVAL)) || DEFAULT_INTERVAL;
    if (!ALLOWED_INTERVALS.includes(intervalMs)) intervalMs = DEFAULT_INTERVAL;

    const syncUrl = container.dataset.syncUrl || '/admin/shifts/sync-state';

    const describeInterval = () => `${Math.round(intervalMs / 1000)} giây`;

    const idleText = () => enabled
        ? `Đồng bộ tự động đang bật · kiểm tra mỗi ${describeInterval()}.`
        : 'Đồng bộ tự động đang tắt.';

    const setIdleStatus = () => {
        if (!refreshPending) status.textContent = idleText();
    };

    const hideRefreshButton = () => {
        refreshButton.classList.add('hidden');
        refreshButton.classList.remove('inline-flex');
    };

    const showRefreshButton = () => {
        refreshButton.classList.remove('hidden');
        refreshButton.classList.add('inline-flex');
    };

    const canApplyWithoutLosingInput = () => {
        // Kiểm tra mọi modal, không chỉ modal đầu tiên trong trang.
        const modalIsOpen = Array.from(document.querySelectorAll('[id$="-modal"]'))
            .some((modal) => !modal.classList.contains('hidden'));
        const activeElement = document.activeElement;
        const editingField = activeElement && activeElement.matches('input, select, textarea, [contenteditable="true"]');
        return !modalIsOpen && !editingField;
    };

    const buildSyncUrl = () => {
        const url = new URL(syncUrl, window.location.origin);
        const current = new URL(window.location.href);

        // Giữ ngữ cảnh lịch hiện tại để snapshot trả về đúng tuần/bộ lọc.
        ['view', 'date', 'month', 'department', 'shift_id', 'search'].forEach((key) => {
            const value = current.searchParams.get(key);
            if (value) url.searchParams.set(key, value);
        });

        const calendarView = document.getElementById('calendar-view-container');
        if (calendarView && calendarView.classList.contains('hidden')) {
            url.searchParams.set('include_calendar', '0');
        }

        return url;
    };

    const fetchSnapshot = async () => {
        const response = await fetch(buildSyncUrl().toString(), {
            headers: { Accept: 'application/json' },
            cache: 'no-store'
        });
        if (!response.ok) throw new Error('Không thể đọc trạng thái đồng bộ');
        const data = await response.json();
        if (!data || !data.revision) throw new Error('Dữ liệu đồng bộ không hợp lệ');
        return data;
    };

    const applySnapshot = async (data) => {
        // Trang phân ca tự cập nhật lịch tại chỗ, không reload.
        const appliedInPlace = typeof window.refreshShiftSchedule === 'function'
            ? window.refreshShiftSchedule(data)
            : false;

        if (appliedInPlace) {
            revision = String(data.revision);
            container.dataset.revision = revision;
            refreshPending = false;
            hideRefreshButton();

            const time = new Date().toLocaleTimeString('vi-VN', {
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
            status.textContent = `Đã tự cập nhật lịch lúc ${time}.`;
            window.setTimeout(setIdleStatus, 4000);
            return true;
        }

        // Trang danh sách ca hoặc chế độ danh sách phân ca: fallback reload.
        if (!canApplyWithoutLosingInput()
            && !window.confirm('Tải lại trang sẽ bỏ nội dung chưa lưu. Bạn có muốn tiếp tục?')) {
            return false;
        }

        window.location.reload();
        return true;
    };

    const checkForChanges = async () => {
        if (!enabled || document.hidden) return;

        // Đang có đổi mới nhưng bị hoãn do modal/input: tự áp dụng ngay khi an toàn.
        if (refreshPending) {
            if (!canApplyWithoutLosingInput()) return;
            const snapshot = pendingSnapshot || await fetchSnapshot().catch(() => null);
            if (!snapshot) return;
            await applySnapshot(snapshot);
            pendingSnapshot = null;
            return;
        }

        try {
            const data = await fetchSnapshot();

            if (!revision) {
                revision = String(data.revision);
                container.dataset.revision = revision;
                setIdleStatus();
                return;
            }

            if (String(data.revision) === revision) {
                if (refreshPending) {
                    refreshPending = false;
                    pendingSnapshot = null;
                    hideRefreshButton();
                    setIdleStatus();
                }
                return;
            }

            if (canApplyWithoutLosingInput()) {
                await applySnapshot(data);
            } else {
                // Đang mở modal / đang nhập: chỉ báo, chờ an toàn rồi tự áp dụng.
                refreshPending = true;
                pendingSnapshot = data;
                status.textContent = 'Có thay đổi mới về ca hoặc lịch trực.';
                showRefreshButton();
            }
        } catch (error) {
            if (!refreshPending) {
                status.textContent = 'Tạm thời chưa kết nối được trạng thái đồng bộ.';
            }
        }
    };

    const restartTimer = () => {
        if (timer) window.clearInterval(timer);
        timer = null;
        setIdleStatus();
        if (enabled) timer = window.setInterval(checkForChanges, intervalMs);
    };

    if (toggle) {
        toggle.checked = enabled;
        toggle.addEventListener('change', () => {
            enabled = toggle.checked;
            localStorage.setItem(STORAGE_ENABLED, enabled ? '1' : '0');
            refreshPending = false;
            pendingSnapshot = null;
            hideRefreshButton();
            restartTimer();
        });
    }

    if (intervalSelect) {
        intervalSelect.value = String(intervalMs);
        intervalSelect.addEventListener('change', () => {
            intervalMs = Number(intervalSelect.value) || DEFAULT_INTERVAL;
            localStorage.setItem(STORAGE_INTERVAL, String(intervalMs));
            restartTimer();
        });
    }

    refreshButton.addEventListener('click', async () => {
        try {
            const data = pendingSnapshot || await fetchSnapshot();
            await applySnapshot(data);
            pendingSnapshot = null;
        } catch (error) {
            window.location.reload();
        }
    });

    restartTimer();
})();
