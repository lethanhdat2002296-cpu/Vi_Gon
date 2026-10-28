// Các file test dùng chung 1 database test (TEST_DATABASE_URL) nên chạy lần lượt, không song song.
module.exports = { test: { fileParallelism: false } };
