import { useState, useRef, useEffect } from 'react';
import { LightBulbIcon, XMarkIcon } from '@heroicons/react/24/outline';

interface ImageCropperModalProps {
	isOpen: boolean;
	onClose: () => void;
	onSave: (croppedImage: string) => void;
	aspectRatio?: 'avatar' | 'banner'; // avatar = 1:1, banner = 3:1
	title: string;
}

export default function ImageCropperModal({
	isOpen,
	onClose,
	onSave,
	aspectRatio = 'avatar',
	title,
}: ImageCropperModalProps) {
	const [image, setImage] = useState<HTMLImageElement | null>(null);
	const [scale, setScale] = useState(1);
	const [position, setPosition] = useState({ x: 0, y: 0 });
	const [isDragging, setIsDragging] = useState(false);
	const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const canvasWidth = aspectRatio === 'avatar' ? 400 : 600;
	const canvasHeight = aspectRatio === 'avatar' ? 400 : 200;

	const drawCanvas = () => {
		const canvas = canvasRef.current;
		if (!canvas || !image) return;

		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		// Clear canvas
		ctx.clearRect(0, 0, canvas.width, canvas.height);

		// Draw image
		ctx.drawImage(
			image,
			position.x,
			position.y,
			image.width * scale,
			image.height * scale
		);

		// Draw overlay for circular crop if avatar
		if (aspectRatio === 'avatar') {
			ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			
			ctx.globalCompositeOperation = 'destination-out';
			ctx.beginPath();
			ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2, 0, Math.PI * 2);
			ctx.fill();
			ctx.globalCompositeOperation = 'source-over';
		}
	};

	useEffect(() => {
		if (image && canvasRef.current) {
			drawCanvas();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [image, scale, position]);

	const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (file) {
			const reader = new FileReader();
			reader.onload = (event) => {
				const img = new Image();
				img.onload = () => {
					setImage(img);
					// Center the image and set initial scale
					const scaleX = canvasWidth / img.width;
					const scaleY = canvasHeight / img.height;
					const initialScale = Math.max(scaleX, scaleY);
					setScale(initialScale);
					setPosition({
						x: (canvasWidth - img.width * initialScale) / 2,
						y: (canvasHeight - img.height * initialScale) / 2,
					});
				};
				img.src = event.target?.result as string;
			};
			reader.readAsDataURL(file);
		}
	};

	const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
		setIsDragging(true);
		setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
	};

	const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
		if (!isDragging) return;
		setPosition({
			x: e.clientX - dragStart.x,
			y: e.clientY - dragStart.y,
		});
	};

	const handleMouseUp = () => {
		setIsDragging(false);
	};

	const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
		const touch = e.touches[0];
		setIsDragging(true);
		setDragStart({ x: touch.clientX - position.x, y: touch.clientY - position.y });
	};

	const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
		if (!isDragging) return;
		const touch = e.touches[0];
		setPosition({
			x: touch.clientX - dragStart.x,
			y: touch.clientY - dragStart.y,
		});
	};

	const handleTouchEnd = () => {
		setIsDragging(false);
	};

	const handleSave = () => {
		const canvas = canvasRef.current;
		if (!canvas || !image) return;

		// Create a new canvas for the final cropped image
		const finalCanvas = document.createElement('canvas');
		finalCanvas.width = canvasWidth;
		finalCanvas.height = canvasHeight;
		const finalCtx = finalCanvas.getContext('2d');
		if (!finalCtx) return;

		// Draw the image
		finalCtx.drawImage(
			image,
			position.x,
			position.y,
			image.width * scale,
			image.height * scale
		);

		// If avatar, create circular crop
		if (aspectRatio === 'avatar') {
			const circularCanvas = document.createElement('canvas');
			circularCanvas.width = canvasWidth;
			circularCanvas.height = canvasHeight;
			const circularCtx = circularCanvas.getContext('2d');
			if (!circularCtx) return;

			// Create circular clipping path
			circularCtx.beginPath();
			circularCtx.arc(canvasWidth / 2, canvasHeight / 2, canvasWidth / 2, 0, Math.PI * 2);
			circularCtx.closePath();
			circularCtx.clip();

			// Draw the final image
			circularCtx.drawImage(finalCanvas, 0, 0);

			// Convert to base64
			const croppedImage = circularCanvas.toDataURL('image/png', 0.9);
			onSave(croppedImage);
		} else {
			// For banner, just use the rectangular crop
			const croppedImage = finalCanvas.toDataURL('image/jpeg', 0.9);
			onSave(croppedImage);
		}

		onClose();
	};

	const handleReset = () => {
		if (image) {
			const scaleX = canvasWidth / image.width;
			const scaleY = canvasHeight / image.height;
			const initialScale = Math.max(scaleX, scaleY);
			setScale(initialScale);
			setPosition({
				x: (canvasWidth - image.width * initialScale) / 2,
				y: (canvasHeight - image.height * initialScale) / 2,
			});
		}
	};

	if (!isOpen) return null;

	return (
		<div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
			<div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl p-6">
				<div className="flex items-center justify-between mb-4">
					<h2 className="text-xl font-bold text-gray-900 dark:text-white">
						{title}
					</h2>
					<button
						onClick={onClose}
						className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
						aria-label="Close"
					>
						<XMarkIcon className="w-6 h-6" />
					</button>
				</div>

				{!image ? (
					<div className="space-y-4">
						<input
							ref={fileInputRef}
							type="file"
							accept="image/*"
							onChange={handleFileSelect}
							className="hidden"
							aria-label="Select image file"
						/>
						<button
							onClick={() => fileInputRef.current?.click()}
							className="w-full py-8 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:border-primary-500 dark:hover:border-primary-400 transition-colors"
						>
							<div className="text-center">
								<p className="text-gray-600 dark:text-gray-400 font-medium">
									Click to select an image
								</p>
								<p className="text-sm text-gray-500 dark:text-gray-500 mt-1">
									PNG, JPG, GIF up to 10MB
								</p>
							</div>
						</button>
					</div>
				) : (
					<div className="space-y-4">
						{/* Canvas for cropping */}
						<div className="flex justify-center bg-gray-900 rounded-lg p-4">
							<canvas
								ref={canvasRef}
								width={canvasWidth}
								height={canvasHeight}
								className="cursor-move"
								onMouseDown={handleMouseDown}
								onMouseMove={handleMouseMove}
								onMouseUp={handleMouseUp}
								onMouseLeave={handleMouseUp}
								onTouchStart={handleTouchStart}
								onTouchMove={handleTouchMove}
								onTouchEnd={handleTouchEnd}
							/>
						</div>

						{/* Zoom control */}
						<div className="space-y-2">
							<label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
								Zoom: {(scale * 100).toFixed(0)}%
							</label>
							<input
								type="range"
								min="0.1"
								max="3"
								step="0.05"
								value={scale}
								onChange={(e) => setScale(parseFloat(e.target.value))}
								className="w-full"
								aria-label="Zoom level"
							/>
						</div>

						{/* Instructions */}
						<div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
							<div className="text-sm text-blue-800 dark:text-blue-200 inline-flex items-start gap-2">
								<LightBulbIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
								<span>Drag the image to reposition, use the slider to zoom</span>
							</div>
						</div>

						{/* Action buttons */}
						<div className="flex gap-3">
							<button
								onClick={handleReset}
								className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
							>
								Reset
							</button>
							<button
								onClick={() => {
									setImage(null);
									setScale(1);
									setPosition({ x: 0, y: 0 });
								}}
								className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
							>
								Change Image
							</button>
							<button
								onClick={handleSave}
								className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
							>
								Save
							</button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
