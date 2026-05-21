<?php

namespace App\Controller;

use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;

class ProductController extends AbstractController
{
    #[Route('/products', name: 'product_index', methods: ['GET'])]
    public function index(): JsonResponse
    {
        return $this->json([]);
    }

    #[Route('/products', name: 'product_store', methods: ['POST'])]
    public function store(): JsonResponse
    {
        return $this->json([], 201);
    }

    #[Route('/products/{id}', name: 'product_show', methods: ['GET'])]
    public function show(int $id): JsonResponse
    {
        return $this->json([]);
    }
}
