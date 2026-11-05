-- What the demo shows: psql -d cooperative -f scripts/demo-report.sql

\echo '== Load by day: the worst minute, and how often the server dropped packets'
SELECT at::date AS day, max(cpu_pct) AS max_cpu, max(mem_used_mb) AS max_mem_mb, max(tx_pps) AS max_tx_pps,
       max(demo_camera + demo_audio + real_lessons) AS max_lessons, max(teachers + students) AS max_people,
       sum(udp_dropped) AS udp_dropped, count(*) FILTER (WHERE udp_dropped > 0) AS minutes_with_drops
FROM load_samples GROUP BY 1 ORDER BY 1 DESC;

\echo '== Busiest minutes'
SELECT at, cpu_pct, mem_used_mb, tx_pps, udp_dropped, demo_camera, demo_audio, real_lessons, teachers, students
FROM load_samples ORDER BY cpu_pct DESC NULLS LAST LIMIT 10;

\echo '== Demo lessons'
SELECT video_mode, count(*) AS lessons, count(first_student_at) AS with_students, max(peak_students) AS max_students,
       round(avg(extract(epoch FROM ended_at - created_at)) / 60) AS avg_minutes
FROM demo_lessons GROUP BY 1;

\echo '== Solo demos: how far teachers got'
SELECT reached, end_reason, count(*) FROM demo_lessons WHERE video_mode = 'solo' GROUP BY 1, 2 ORDER BY 3 DESC;

\echo '== How they ended'
SELECT end_reason, count(*) FROM demo_lessons WHERE ended_at IS NOT NULL GROUP BY 1 ORDER BY 2 DESC;

\echo '== Addresses that look like scripts: empty lessons again and again, or penalties'
SELECT ip_hash, sum(attempts) AS attempts, sum(refused) AS refused, sum(penalties) AS penalties,
       (SELECT count(*) FROM demo_lessons d WHERE d.ip_hash = s.ip_hash AND d.first_student_at IS NULL AND d.ended_at IS NOT NULL) AS empty_lessons
FROM demo_ip_stats s GROUP BY 1
HAVING sum(penalties) > 0 OR (SELECT count(*) FROM demo_lessons d WHERE d.ip_hash = s.ip_hash AND d.first_student_at IS NULL AND d.ended_at IS NOT NULL) >= 3
ORDER BY 4 DESC, 5 DESC;

\echo '== Feedback'
SELECT created_at::date AS day, rating, email, comment FROM demo_feedback ORDER BY created_at DESC;

\echo '== Bookings: how they ended, and how far ahead they were made'
SELECT status, count(*), count(*) FILTER (WHERE teacher_came) AS teacher_came,
       round(avg(extract(epoch FROM starts_at - created_at)) / 3600, 1) AS avg_hours_ahead
FROM demo_bookings GROUP BY 1 ORDER BY 2 DESC;
