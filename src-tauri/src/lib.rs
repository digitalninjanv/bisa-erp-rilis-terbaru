mod commands;
mod device;
mod displaymap;
mod keychain;
mod posdb;
mod printing;
mod runtime;
mod syncengine;
mod transport;
mod updater;

use std::sync::{Arc, Mutex};

use tauri::Manager;

/// Titik masuk aplikasi desktop Bisa POS (Tauri v2).
///
/// Database lokal dibuka di direktori data aplikasi OS
/// (app_data_dir) sebagai `bisa-pos.db` dan skemanya diterapkan
/// sebelum jendela menerima command apa pun. Konfigurasi perangkat
/// (URL server + token) dimuat dari berkas milik Rust di direktori
/// yang sama (tokennya sendiri hidup di keychain OS sejak
/// Langkah 6 — berkas hanya menyimpan URL + token fallback);
/// item outbox `inflight` yatim dikembalikan ke
/// `pending` dan tugas cetak `printing` yatim ke `pending`; lalu
/// thread latar mesin sinkron, pekerja cetak, dan pemeriksa
/// pembaruan mulai berjalan (Langkah 4 D7, Langkah 5 D6,
/// Langkah 7 D4).
pub fn run() {
    tauri::Builder::default()
        // Langkah 7 (D4): plugin updater resmi — pubkey verifikasi
        // dari tauri.conf.json; endpoint dibangun runtime oleh glue
        // (keputusan server per terminal).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let conn = posdb::open(&data_dir.join("bisa-pos.db"))?;
            // Pemulihan startup: klaim inflight dari proses yang
            // mati di tengah pengiriman kembali ke pending (aman —
            // server menolak duplikat per clientKey).
            let _ = posdb::reset_inflight(&conn, &posdb::now_iso());
            // Pemulihan cetak: tugas `printing` dari proses yang
            // mati di tengah kirim kembali ke `pending`.
            let _ = posdb::reset_printing(&conn, &posdb::now_iso());
            // Langkah 6 (D5): token dimuat dari keychain OS;
            // token warisan berkas 0600 bermigrasi otomatis di
            // dalam load_config (fallback berkas terlihat di UI
            // bila vault OS tidak tersedia).
            let store = Arc::new(keychain::KeyringStore);
            let (config, storage) = device::load_config(&data_dir, store.as_ref());
            let printer_config = device::load_printer(&data_dir);
            app.manage(runtime::DbState(Mutex::new(conn)));
            app.manage(runtime::PrinterState {
                dir: data_dir.clone(),
                config: Mutex::new(printer_config),
            });
            app.manage(runtime::DeviceState {
                dir: data_dir,
                config: Mutex::new(config),
                store,
                storage: Mutex::new(storage),
            });
            app.manage(runtime::SyncState::new());
            app.manage(runtime::PrintState::new());
            app.manage(runtime::UpdateState::new(
                &app.package_info().version.to_string(),
            ));
            // Langkah 8: keadaan tampil layar pelanggan (penulis
            // tunggalnya jendela utama; jendela kedua hanya membaca
            // + mendengarkan event `pos-display`).
            app.manage(runtime::DisplayState::new());
            runtime::spawn_background(app.handle().clone());
            runtime::spawn_print_background(app.handle().clone());
            runtime::spawn_update_background(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::snapshot_info,
            commands::list_snapshot_products_page,
            commands::find_snapshot_product_by_code,
            commands::list_snapshot_payment_methods,
            commands::record_local_sale,
            commands::list_outbox,
            commands::list_outbox_page,
            commands::get_device_status,
            commands::pair_device,
            commands::unpair_device,
            commands::refresh_snapshot,
            commands::sync_now,
            commands::get_update_status,
            commands::check_update_now,
            commands::install_update_now,
            commands::open_cash_session,
            commands::close_cash_session,
            commands::current_cash_session,
            commands::list_cash_sessions,
            commands::count_cash_sessions,
            commands::list_local_intents,
            commands::get_printer_status,
            commands::set_printer_config,
            commands::list_print_jobs,
            commands::print_receipt,
            commands::test_print,
            commands::open_drawer,
            commands::update_customer_display,
            commands::get_customer_display,
            commands::open_customer_display,
            commands::close_customer_display,
            commands::customer_display_open,
        ])
        .run(tauri::generate_context!())
        .expect("gagal menjalankan aplikasi Bisa POS");
}
