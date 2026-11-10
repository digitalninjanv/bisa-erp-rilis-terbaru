// Mencegah jendela konsol tambahan di Windows pada rilis produksi.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    bisa_pos_lib::run();
}
