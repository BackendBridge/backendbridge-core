<?php

namespace App\Http\Controllers;

use App\Services\PostService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PostController extends Controller
{
    public function __construct(private PostService $postService) {}

    public function index(): JsonResponse { return response()->json([]); }
    public function store(Request $request): JsonResponse { return response()->json([], 201); }
    public function show(int $id): JsonResponse { return response()->json([]); }
    public function update(Request $request, int $id): JsonResponse { return response()->json([]); }
    public function destroy(int $id): JsonResponse { return response()->json(null, 204); }
}
