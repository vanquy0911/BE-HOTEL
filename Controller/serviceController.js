import asyncHandler from "express-async-handler";
import Service from "../Models/ServiceModel.js";

// GET /api/services - Lấy tất cả dịch vụ
export const getAllServices = asyncHandler(async (req, res) => {
  const { category, isActive } = req.query;
  const filter = {};
  if (category) filter.category = category;
  if (isActive !== undefined) filter.isActive = isActive === 'true';
  
  const services = await Service.find(filter).sort({ category: 1, name: 1 });
  
  // Map từ backend format sang frontend format
  const mappedServices = services.map(service => ({
    _id: service._id,
    name: service.name,
    description: service.description || '',
    category: service.category || 'other',
    pricing: {
      type: service.priceUnit === 'per_hour' ? 'per_hour' : 
            service.priceUnit === 'per_day' ? 'per_day' : 'fixed',
      amount: service.price || 0
    },
    isAvailable: service.isActive !== false,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt
  }));
  
  res.json({ success: true, data: mappedServices });
});

// GET /api/services/:id - Lấy dịch vụ theo ID
export const getServiceById = asyncHandler(async (req, res) => {
  const service = await Service.findById(req.params.id);
  if (!service) {
    return res.status(404).json({ message: "Dịch vụ không tồn tại" });
  }
  
  // Map từ backend format sang frontend format
  const mappedService = {
    _id: service._id,
    name: service.name,
    description: service.description || '',
    category: service.category || 'other',
    pricing: {
      type: service.priceUnit === 'per_hour' ? 'per_hour' : 
            service.priceUnit === 'per_day' ? 'per_day' : 'fixed',
      amount: service.price || 0
    },
    isAvailable: service.isActive !== false,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt
  };
  
  res.json({ success: true, data: mappedService });
});

// POST /api/services - Tạo dịch vụ mới (Admin)
export const createService = asyncHandler(async (req, res) => {
  // Map từ frontend format sang backend format
  const serviceData = {
    name: req.body.name,
    description: req.body.description,
    category: req.body.category || 'other',
    price: req.body.pricing?.amount || 0,
    priceUnit: req.body.pricing?.type === 'per_hour' ? 'per_hour' :
               req.body.pricing?.type === 'per_day' ? 'per_day' : 'VND',
    isActive: req.body.isAvailable !== false
  };
  
  const service = new Service(serviceData);
  await service.save();
  
  // Trả về frontend format
  const mappedService = {
    _id: service._id,
    name: service.name,
    description: service.description || '',
    category: service.category || 'other',
    pricing: {
      type: service.priceUnit === 'per_hour' ? 'per_hour' : 
            service.priceUnit === 'per_day' ? 'per_day' : 'fixed',
      amount: service.price || 0
    },
    isAvailable: service.isActive !== false,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt
  };
  
  res.status(201).json({ success: true, data: mappedService });
});

// PUT /api/services/:id - Cập nhật dịch vụ (Admin)
export const updateService = asyncHandler(async (req, res) => {
  // Map từ frontend format sang backend format
  const updateData = {
    name: req.body.name,
    description: req.body.description,
    category: req.body.category || 'other',
    price: req.body.pricing?.amount || 0,
    priceUnit: req.body.pricing?.type === 'per_hour' ? 'per_hour' :
               req.body.pricing?.type === 'per_day' ? 'per_day' : 'VND',
    isActive: req.body.isAvailable !== false
  };
  
  const service = await Service.findByIdAndUpdate(
    req.params.id,
    updateData,
    { new: true, runValidators: true }
  );
  if (!service) {
    return res.status(404).json({ message: "Dịch vụ không tồn tại" });
  }
  
  // Trả về frontend format
  const mappedService = {
    _id: service._id,
    name: service.name,
    description: service.description || '',
    category: service.category || 'other',
    pricing: {
      type: service.priceUnit === 'per_hour' ? 'per_hour' : 
            service.priceUnit === 'per_day' ? 'per_day' : 'fixed',
      amount: service.price || 0
    },
    isAvailable: service.isActive !== false,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt
  };
  
  res.json({ success: true, data: mappedService });
});

// DELETE /api/services/:id - Xóa dịch vụ (Admin)
export const deleteService = asyncHandler(async (req, res) => {
  const service = await Service.findByIdAndDelete(req.params.id);
  if (!service) {
    return res.status(404).json({ message: "Dịch vụ không tồn tại" });
  }
  res.json({ message: "Đã xóa dịch vụ" });
});

