<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreOrderRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'product_id' => 'required|integer',
            'quantity' => 'required|integer|min:1|max:100',
            'status' => 'sometimes|in:pending,processing,shipped,delivered',
        ];
    }
}
