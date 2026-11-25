<?php
// Helper respons standar legacy API KlinikFlow

function sendJson($data, $statusCode = 200) {
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    // Header keamanan dasar untuk seluruh respons layanan legacy.
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: no-referrer');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

function sendError($message, $statusCode = 400) {
    sendJson([
        'success' => false,
        'error' => $message
    ], $statusCode);
}

